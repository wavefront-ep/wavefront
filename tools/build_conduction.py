"""Build the conduction system tubes and the activation graph.

Outputs (public/heart):
  conduction.glb   one named mesh per conduction structure (cs_*)
  conduction.json  graph metadata, named nodes, per-mesh vertex mapping, constants
  graph.bin        binary arrays referenced by conduction.json

Graph: coarse tissue nodes (atrial and ventricular working myocardium, class-aware so atrial and
ventricular muscle are only joined through the AV node and His-Purkinje system), plus chains of
nodes along every conduction path. Edge time = length / velocity + delay; velocities live in
src/engine/constants.ts and are mirrored in CONSTANTS below for the reference solver here.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).parent))
from build_heart import write_glb  # noqa: E402
from conduction_geometry import Geometry, arclen  # noqa: E402
from heartdata import ROOT  # noqa: E402

OUT = ROOT / "public/heart"

# Edge kinds (index = kind id used by the engine).
KINDS = ["atrial", "ventricular", "san", "bachmann", "avn", "his", "bundle", "purkinje", "avn_in", "pmj"]
# Conduction velocities in m/s (= mm/ms). SPEC section 5 starting values; to be confirmed.
CONSTANTS = dict(
    v_atrial=1.0, v_ventricular=0.5, v_san=0.3, v_bachmann=1.5, v_avn=0.08, v_his=2.0,
    v_bundle=3.0, v_purkinje=3.0, v_avn_in=1.0, v_pmj=0.5, pmj_delay_ms=3.0,
    apd_atrial=190.0, apd_ventricular=280.0, apd_conduction=110.0,
)
VEL = {k: CONSTANTS[f"v_{k}"] for k in KINDS if f"v_{k}" in CONSTANTS}
VEL_BY_KIND = np.array([CONSTANTS["v_atrial"], CONSTANTS["v_ventricular"], CONSTANTS["v_san"], CONSTANTS["v_bachmann"],
                        CONSTANTS["v_avn"], CONSTANTS["v_his"], CONSTANTS["v_bundle"], CONSTANTS["v_purkinje"],
                        CONSTANTS["v_avn_in"], CONSTANTS["v_pmj"]])

ATRIAL_LABELS = [3, 4] + list(range(11, 25))
VENT_LABELS = [1, 2]
LA_LABELS = {3, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22}


def tissue_graph(P, T, L, r_atrial=1.7, r_vent=3.0):
    """Coarse tissue graph. Returns node positions, class (0 atrial, 1 ventricular), region
    (1 LV, 2 RV, 3 LA, 4 RA) and the edge list (a, b, length)."""
    n = len(P)
    counts = np.zeros((n, 25), dtype=np.int32)
    for lab in range(1, 25):
        nodes = T[L == lab].ravel()
        np.add.at(counts[:, lab], nodes, 1)
    cond = [l for l in VENT_LABELS + ATRIAL_LABELS]
    sub = counts[:, cond]
    best = np.array(cond)[sub.argmax(1)]
    has = sub.max(1) > 0
    fine_cls = np.where(np.isin(best, VENT_LABELS), 1, 0)
    fine_reg = np.where(best == 1, 1, np.where(best == 2, 2, np.where(np.isin(best, list(LA_LABELS)), 3, 4)))

    samples = []
    for cls, r in ((0, r_atrial), (1, r_vent)):
        idx = np.where(has & (fine_cls == cls))[0]
        key = np.floor(P[idx] / r).astype(np.int64)
        # one node per voxel: the one closest to the voxel's mean position
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        mean = np.zeros((inv.max() + 1, 3))
        cnt = np.bincount(inv)
        for k in range(3):
            mean[:, k] = np.bincount(inv, weights=P[idx][:, k]) / cnt
        d = np.linalg.norm(P[idx] - mean[inv], axis=1)
        order = np.lexsort((d, inv))
        first = np.r_[True, inv[order][1:] != inv[order][:-1]]
        samples.append(idx[order[first]])
    sample_idx = np.concatenate(samples)
    cls = fine_cls[sample_idx]
    reg = fine_reg[sample_idx]
    pos = P[sample_idx]

    # cluster assignment: nearest sample of the same class
    cluster = np.full(n, -1, dtype=np.int64)
    for c in (0, 1):
        sel = np.where(cls == c)[0]
        tree = cKDTree(pos[sel])
        fine = np.where(has & (fine_cls == c))[0]
        _, nn = tree.query(P[fine])
        cluster[fine] = sel[nn]

    # fine tet edges -> cluster edges (same class only)
    e = np.vstack([T[:, [0, 1]], T[:, [0, 2]], T[:, [0, 3]], T[:, [1, 2]], T[:, [1, 3]], T[:, [2, 3]]])
    ca, cb = cluster[e[:, 0]], cluster[e[:, 1]]
    ok = (ca >= 0) & (cb >= 0) & (ca != cb)
    ca, cb = ca[ok], cb[ok]
    lo, hi = np.minimum(ca, cb), np.maximum(ca, cb)
    code = np.unique(lo * (len(pos) + 1) + hi)
    a, b = code // (len(pos) + 1), code % (len(pos) + 1)
    same = cls[a] == cls[b]
    a, b = a[same], b[same]
    length = np.linalg.norm(pos[a] - pos[b], axis=1)
    return pos, cls, reg, np.stack([a, b], 1), length, cluster


class Builder:
    def __init__(self):
        self.g = Geometry().build_all()
        P, T, L, _ = self.g.P, self.g.T, self.g.L, None
        self.pos, self.cls, self.reg, e, el, self.cluster = tissue_graph(P, T, L)
        self.n_tissue = len(self.pos)
        self.edges = [(int(a), int(b), float(l), 0 if self.cls[a] == 0 else 1, 0.0) for (a, b), l in zip(e, el)]
        self.node_pos = [p for p in self.pos]
        self.node_cls = list(self.cls)
        self.node_reg = list(self.reg)
        self.path_nodes = {}  # name -> list of node ids
        self.named = {}
        self.tissue_tree = {c: cKDTree(self.pos[self.cls == c]) for c in (0, 1)}
        self.tissue_ids = {c: np.where(self.cls == c)[0] for c in (0, 1)}

    def add_node(self, p, cls=2, reg=0):
        self.node_pos.append(np.asarray(p, dtype=float))
        self.node_cls.append(cls)
        self.node_reg.append(reg)
        return len(self.node_pos) - 1

    def add_chain(self, name, pts, kind):
        ids = [self.add_node(p) for p in pts]
        k = KINDS.index(kind)
        for a, b in zip(ids[:-1], ids[1:]):
            self.edges.append((a, b, float(np.linalg.norm(self.node_pos[a] - self.node_pos[b])), k, 0.0))
        self.path_nodes[name] = ids
        return ids

    def link_to_tissue(self, node, cls, radius, kind, delay=0.0, max_links=6):
        tree, ids = self.tissue_tree[cls], self.tissue_ids[cls]
        near = tree.query_ball_point(self.node_pos[node], radius)
        if not near:
            _, j = tree.query(self.node_pos[node])
            near = [int(j)]
        near = sorted(near, key=lambda j: np.linalg.norm(self.pos[ids[j]] - self.node_pos[node]))[:max_links]
        for j in near:
            t = int(ids[j])
            self.edges.append((node, t, float(np.linalg.norm(self.pos[t] - self.node_pos[node])), KINDS.index(kind), delay))

    def link_nodes(self, a, b, kind):
        self.edges.append((a, b, float(np.linalg.norm(self.node_pos[a] - self.node_pos[b])), KINDS.index(kind), 0.0))

    def nearest_in(self, ids, p):
        ids = list(ids)
        d = [np.linalg.norm(self.node_pos[i] - p) for i in ids]
        return ids[int(np.argmin(d))]

    # --------------------------------------------------------------------- assemble
    def assemble(self):
        g = self.g
        P = g.paths
        # chains in the conducting path order
        for name in ("SAN", "AVN", "His", "Bachmann", "LBB", "LSF", "LAF", "LPF", "RBB_entry", "RBB"):
            kind = {"SAN": "san", "AVN": "avn", "His": "his", "Bachmann": "bachmann", "RBB_entry": "his"}.get(name, "bundle")
            self.add_chain(name, P[name]["points"], kind)
        # internodal bands are drawn only; they are not separate conduction paths (schematic)

        n = self.path_nodes
        # sinoatrial node: pacemaker at its centre, exit into the right atrium along its whole length
        san = n["SAN"]
        self.named["SAN"] = san[len(san) // 2]
        for node in san:
            self.link_to_tissue(node, 0, 3.2, "san", max_links=3)
        # AV node: atrial muscle enters at the posterior-inferior end only
        avn = n["AVN"]
        self.link_to_tissue(avn[0], 0, 3.5, "avn_in")
        self.named["AVN_entry"], self.named["AVN_exit"] = avn[0], avn[-1]
        # His
        his = n["His"]
        self.link_nodes(avn[-1], his[0], "avn")
        self.named["His_proximal"], self.named["His_distal"] = his[0], his[-1]
        # right bundle: starts from the middle of the His bundle
        mid = his[len(his) // 2]
        rbe = n["RBB_entry"]
        self.link_nodes(mid, rbe[0], "his")
        self.link_nodes(rbe[-1], n["RBB"][0], "bundle")
        self.named["RBB_start"] = n["RBB"][0]
        # left bundle
        self.link_nodes(his[-1], n["LBB"][0], "bundle")
        self.named["LBB_start"] = n["LBB"][0]
        for f in ("LSF", "LAF", "LPF"):
            self.link_nodes(n["LBB"][-1], n[f][0], "bundle")
            self.named[f"{f}_end"] = n[f][-1]
        # Bachmann's bundle: coupled to atrial muscle at its two ends
        bb = n["Bachmann"]
        for node in bb[:2]:
            self.link_to_tissue(node, 0, 3.5, "bachmann", max_links=3)
        for node in bb[-2:]:
            self.link_to_tissue(node, 0, 3.5, "bachmann", max_links=3)

        # Purkinje networks
        self.purk_nodes = {}
        for which in ("LV", "RV"):
            pk = g.purk[which]
            V, N, _ = g.surf[pk["surf"]]
            lift = lambda i: V[i] + N[i] * 0.3
            verts = sorted({v for e in pk["edges"] for v in e} | set(pk["roots"]))
            node_of = {v: self.add_node(lift(v)) for v in verts}
            for a, b in pk["edges"]:
                na, nb = node_of[a], node_of[b]
                self.edges.append((na, nb, float(np.linalg.norm(self.node_pos[na] - self.node_pos[nb])), KINDS.index("purkinje"), 0.0))
            # roots join the end of their fascicle (LV) or the right bundle end (RV)
            if which == "LV":
                for fname, root in zip(("LSF", "LAF", "LPF"), pk["roots"]):
                    self.link_nodes(n[fname][-1], node_of[root], "bundle")
            else:
                self.link_nodes(n["RBB"][-1], node_of[pk["roots"][0]], "bundle")
            # PMJs: terminals couple to the nearest ventricular muscle, with a delay
            for t in pk["terminals"]:
                self.link_to_tissue(node_of[t], 1, 4.5, "pmj", CONSTANTS["pmj_delay_ms"], max_links=2)
            self.purk_nodes[which] = node_of
            self.named[f"Purkinje_{which}_first"] = None

    # --------------------------------------------------------------------- reference solver
    def solve(self, constants=CONSTANTS):
        npos = len(self.node_pos)
        e = np.array([(a, b) for a, b, *_ in self.edges])
        el = np.array([x[2] for x in self.edges])
        ek = np.array([x[3] for x in self.edges])
        ed = np.array([x[4] for x in self.edges])
        t = el / VEL_BY_KIND[ek] + ed
        A = coo_matrix((np.r_[t, t], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(npos, npos)).tocsr()
        return dijkstra(A, directed=False, indices=self.named["SAN"])


def tube(points, radii, sides=8):
    """Tube mesh along a polyline. Returns V, N, F and the ring index of every vertex."""
    pts = np.asarray(points, dtype=float)
    n = len(pts)
    tang = np.gradient(pts, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    ref = np.array([0.0, 1.0, 0.0])
    V, N, ring = [], [], []
    prev_u = None
    for i in range(n):
        t = tang[i]
        u = np.cross(t, ref if abs(t @ ref) < 0.95 else np.array([1.0, 0.0, 0.0]))
        u /= np.linalg.norm(u)
        if prev_u is not None and u @ prev_u < 0:
            u = -u
        v = np.cross(t, u)
        prev_u = u
        for k in range(sides):
            a = 2 * np.pi * k / sides
            d = np.cos(a) * u + np.sin(a) * v
            V.append(pts[i] + d * radii[i])
            N.append(d)
            ring.append(i)
    F = []
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            c, d = (i + 1) * sides + k, (i + 1) * sides + (k + 1) % sides
            F += [[a, c, b], [b, c, d]]
    return np.array(V), np.array(N), np.array(F), np.array(ring)


def radius_profile(n, base, swell=1.0):
    if swell == 1.0:
        return np.full(n, base)
    x = np.linspace(0, 1, n)
    return base * (1 + (swell - 1) * np.sin(np.pi * x) ** 0.8)


def main():
    b = Builder()
    b.assemble()
    g = b.g
    # ---------------- reference activation
    t = b.solve()
    cls = np.array(b.node_cls)
    reg = np.array(b.node_reg)
    tissue = np.arange(len(t)) < b.n_tissue
    print("nodes", len(t), "tissue", b.n_tissue, "edges", len(b.edges))
    print("unreached tissue nodes:", int(np.isinf(t[tissue]).sum()))
    at = t[tissue & (cls == 0)]
    vt = t[tissue & (cls == 1)]
    print(f"atrial activation  {at.min():.0f} - {at.max():.0f} ms")
    print(f"ventricular act.   {vt.min():.0f} - {vt.max():.0f} ms  (QRS ~ {vt.max() - vt.min():.0f} ms)")
    for k in ("SAN", "AVN_entry", "AVN_exit", "His_distal", "RBB_start", "LBB_start", "LAF_end", "LPF_end", "LSF_end"):
        print(f"  {k:12s} {t[b.named[k]]:6.1f} ms")
    for r, name in ((1, "LV+septum"), (2, "RV"), (3, "LA"), (4, "RA")):
        sel = tissue & (reg == r)
        print(f"  {name:10s} first {t[sel].min():6.1f}  median {np.median(t[sel]):6.1f}  last {t[sel].max():6.1f}")

    # ---------------- tubes
    meshes = {}
    node_of_vertex = {}
    sw = {"SAN": 1.5, "AVN": 1.7, "His": 1.0}
    for name, d in g.paths.items():
        if name in ("RBB_entry",):
            continue
        pts = d["points"]
        rad = radius_profile(len(pts), d["radius"], sw.get(name, 1.0) if name in ("SAN", "AVN") else 1.0)
        V, N, F, ring = tube(pts, rad, sides=10 if name in ("SAN", "AVN") else 8)
        mesh_name = f"cs_{name}"
        meshes[mesh_name] = (V * 0.01, N, F)
        if name in b.path_nodes:
            ids = b.path_nodes[name]
            node_of_vertex[mesh_name] = np.array([ids[i] for i in ring])
        else:  # internodal bands: schematic, not in the graph
            node_of_vertex[mesh_name] = None
    # RBB entry and RBB drawn as one structure
    ent = g.paths["RBB_entry"]["points"]
    V, N, F, ring = tube(ent, np.full(len(ent), g.paths["RBB_entry"]["radius"]), 8)
    meshes["cs_RBB_entry"] = (V * 0.01, N, F)
    node_of_vertex["cs_RBB_entry"] = np.array([b.path_nodes["RBB_entry"][i] for i in ring])

    for which in ("LV", "RV"):
        node_of = b.purk_nodes[which]
        pk = g.purk[which]
        Vs = g.surf[pk["surf"]][0]
        Ns = g.surf[pk["surf"]][1]
        Vv, Nn, Ff, nov = [], [], [], []
        off = 0
        for a, c in pk["edges"]:
            pa, pc = Vs[a] + Ns[a] * 0.3, Vs[c] + Ns[c] * 0.3
            vv, nn, ff, ring = tube(np.array([pa, pc]), np.array([0.3, 0.3]), sides=5)
            Vv.append(vv); Nn.append(nn); Ff.append(ff + off)
            nov.append(np.where(ring == 0, node_of[a], node_of[c]))
            off += len(vv)
        name = f"cs_Purkinje_{which}"
        meshes[name] = (np.vstack(Vv) * 0.01, np.vstack(Nn), np.vstack(Ff))
        node_of_vertex[name] = np.concatenate(nov)

    meshes = {k: (V.astype(np.float32), N.astype(np.float32), F.astype(np.uint32)) for k, (V, N, F) in meshes.items()}
    write_glb(OUT / "conduction.glb", meshes)

    # ---------------- vertex -> node mapping for the myocardial meshes
    mapping = {}
    heart = g.M
    for name, c in (("epi_RA", 0), ("endo_RA", 0), ("epi_LA", 0), ("endo_LA", 0),
                    ("epi_LV", 1), ("endo_LV", 1), ("epi_RV", 1), ("endo_RV", 1)):
        V = heart[name][0]
        ids = b.tissue_ids[c]
        tree = b.tissue_tree[c]
        d, nn = tree.query(V, k=3)
        w = 1.0 / np.maximum(d, 0.2)
        w /= w.sum(1, keepdims=True)
        mapping[name] = (ids[nn].astype(np.uint32), w.astype(np.float32))

    # ---------------- binary + json
    npos = len(b.node_pos)
    blobs = []
    meta = {"arrays": {}}
    off = 0

    def put(key, arr):
        nonlocal off
        arr = np.ascontiguousarray(arr)
        raw = arr.tobytes()
        pad = (-len(raw)) % 4
        meta["arrays"][key] = {"offset": off, "dtype": str(arr.dtype), "shape": list(arr.shape)}
        blobs.append(raw + b"\0" * pad)
        off += len(raw) + pad

    e = np.array([(a, c) for a, c, *_ in b.edges], dtype=np.uint32)
    put("pos", np.array(b.node_pos, dtype=np.float32))
    put("cls", np.array(b.node_cls, dtype=np.uint8))
    put("region", np.array(b.node_reg, dtype=np.uint8))
    put("edges", e)
    put("elen", np.array([x[2] for x in b.edges], dtype=np.float32))
    put("ekind", np.array([x[3] for x in b.edges], dtype=np.uint8))
    put("edelay", np.array([x[4] for x in b.edges], dtype=np.float32))
    for name, (idx, w) in mapping.items():
        put(f"map_{name}_idx", idx)
        put(f"map_{name}_w", w)
    for name, arr in node_of_vertex.items():
        if arr is not None:
            put(f"map_{name}_idx", arr.astype(np.uint32))
    (OUT / "graph.bin").write_bytes(b"".join(blobs))

    meta.update({
        "units": "mm, scene axes (+x patient left, +y superior, +z anterior)",
        "nodes": npos, "tissueNodes": b.n_tissue, "edges": int(len(e)),
        "kinds": KINDS, "constants": CONSTANTS,
        "named": {k: int(v) for k, v in b.named.items() if v is not None},
        "stimulus": {"site": "SAN", "node": int(b.named["SAN"]), "time_ms": 0.0},
        "paths": {k: {"kind": g.paths[k]["kind"], "schematic": bool(g.paths[k]["schematic"]),
                      "length_mm": round(arclen(g.paths[k]["points"]), 1)} for k in g.paths},
        "landmarks": {k: [round(float(x), 2) for x in np.asarray(v).ravel()] for k, v in g.lm.items()
                      if k in ("apex", "base", "cfb", "svc_centre", "ivc_centre", "laa_ostium")},
        "reference": {"atrial_ms": [float(at.min()), float(at.max())], "ventricular_ms": [float(vt.min()), float(vt.max())]},
        "meshes": sorted(meshes) + sorted(mapping),
    })
    (OUT / "conduction.json").write_text(json.dumps(meta, indent=1))
    print("wrote conduction.glb, graph.bin", f"{off/1e6:.2f} MB")


if __name__ == "__main__":
    main()
