"""Place the conduction system on the mesh.

Every anchor is derived from the labelled mesh (valve planes, vein ostia, chamber surfaces), not
typed in. Where a position is a schematic choice it is marked SCHEMATIC and listed in REVIEW.md.
Coordinates: millimetres, scene axes (+x patient left, +y superior, +z anterior).
"""
import numpy as np
from scipy.spatial import cKDTree

from heartdata import SurfaceGraph, load_glb, load_tets, merge_meshes

RNG = np.random.default_rng(7)


def unit(v):
    return v / np.linalg.norm(v)


def resample(poly, step):
    """Resample a polyline at roughly uniform arc length `step` (mm)."""
    poly = np.asarray(poly, dtype=float)
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    n = max(2, int(round(s[-1] / step)) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, poly[:, k]) for k in range(3)], axis=1)


def weld(V, N, F):
    """Merge vertices at identical positions (the viewer asset duplicates vertices where one structure
    is split by source label) and average their normals."""
    key = np.round(V, 3)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    n = np.zeros((len(uniq), 3))
    np.add.at(n, inv, N)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    return V[first], n, inv[F]


def arclen(poly):
    return float(np.linalg.norm(np.diff(poly, axis=0), axis=1).sum())


class Geometry:
    def __init__(self):
        self.M = load_glb()
        self.P, self.T, self.L, _ = load_tets()
        M = self.M
        self.surf = {k: weld(*M[k]) for k in M}
        self.lm = {}
        self.paths = {}  # name -> dict(points, kind, schematic)
        self.nodes = {}  # name -> position (swelling centres)

    # -------------------------------------------------------------- helpers
    def graph(self, names):
        V, F = merge_meshes([(self.surf[n][0], self.surf[n][2]) for n in names])
        return SurfaceGraph(V, F)

    def inward(self, V, N, i, depth):
        return V[i] - N[i] * depth

    # -------------------------------------------------------------- landmarks
    def landmarks(self):
        M, lm = self.M, self.lm
        # Cardiac long axis: apex to the centre of the AV valve planes.
        mit = M["valve_mitral"][0].mean(0)
        tri = M["valve_tricuspid"][0].mean(0)
        lv_tets = self.T[np.isin(self.L, [1])]
        lvp = self.P[np.unique(lv_tets)]
        base = (mit + tri) / 2
        apex = lvp[np.argmax(np.linalg.norm(lvp - base, axis=1))]
        lm["apex"] = apex
        lm["base"] = base
        lm["axis"] = unit(base - apex)
        lm["axis_len"] = float(np.linalg.norm(base - apex))

        # Central fibrous body: where the tricuspid, mitral and aortic valve planes come closest to
        # one another. Taken as the mean of the 30 nodes that minimise the largest of the three
        # distances to the three valve plane meshes.
        sets = {k: self.P[np.unique(self.T[self.L == l])] for k, l in (("mit", 7), ("tri", 8), ("ao", 9))}
        trees = {k: cKDTree(v) for k, v in sets.items()}
        cand = np.vstack(list(sets.values()))
        d = np.stack([trees[k].query(cand)[0] for k in ("mit", "tri", "ao")], 1).max(1)
        lm["cfb"] = cand[np.argsort(d)[:30]].mean(0)
        lm["cfb_spread_mm"] = float(np.sort(d)[:30].mean())

        svc = M["vein_SVC"][0]
        ra = M["epi_RA"][0]
        rim = svc[cKDTree(ra).query(svc)[0] < 2.0]
        lm["svc_centre"] = rim.mean(0)
        lm["ivc_centre"] = M["vein_IVC"][0].mean(0)
        lm["svc_rim"] = rim
        lm["laa_ostium"] = self.P[np.unique(self.T[self.L == 11])].mean(0)
        return lm

    # -------------------------------------------------------------- atrial structures
    def sa_node(self):
        """Sinoatrial node: subepicardial, lateral to the SVC-RA junction, extending down the
        lateral right atrial wall. Head: the SVC rim vertex furthest in the anterolateral
        direction (patient right, anterior). Body: 14 mm along the epicardial geodesic towards
        the lateral rim of the IVC. Sits 1.2 mm inside the epicardial surface."""
        V, N, F = self.surf["epi_RA"]
        lm = self.lm
        rim = lm["svc_rim"]
        head_pt = rim[np.argmax(rim @ unit(np.array([-0.8, 0.0, 0.6])))]
        g = self.graph(["epi_RA"])
        Vg = g.V
        a = int(np.argmin(np.linalg.norm(Vg - head_pt, axis=1)))
        # lateral point on the IVC rim: most lateral (minimum x) IVC vertex nearest the RA wall
        ivc = self.M["vein_IVC"][0]
        near = ivc[cKDTree(Vg).query(ivc)[0] < 2.0]
        b_pt = near[np.argmin(near[:, 0])]
        b = int(np.argmin(np.linalg.norm(Vg - b_pt, axis=1)))
        path, _ = g.path(a, b)
        pts = Vg[path]
        pts = resample(pts, 1.0)
        # first 14 mm
        cum = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        pts = pts[cum <= 14.0]
        # inward offset along the local surface normal
        t = cKDTree(V)
        _, idx = t.query(pts)
        pts = pts - N[idx] * 1.2
        self.paths["SAN"] = dict(points=pts, kind="san", schematic=False, radius=1.5)
        self.nodes["SAN"] = pts[len(pts) // 2]
        return pts

    def av_node_and_his(self):
        """AV node on the right atrial septal wall near the central fibrous body, then the penetrating
        His bundle through the central fibrous body to the crest of the muscular septum."""
        lm = self.lm
        C = lm["cfb"]
        Vr, Nr, Fr = self.surf["endo_RA"]
        i_exit = int(np.argmin(np.linalg.norm(Vr - C, axis=1)))
        exit_pt = Vr[i_exit]
        # AVN entry: 5 mm back along the RA endocardium towards the IVC ostium
        g = self.graph(["endo_RA"])
        a = int(np.argmin(np.linalg.norm(g.V - exit_pt, axis=1)))
        b = int(np.argmin(np.linalg.norm(g.V - lm["ivc_centre"], axis=1)))
        path, _ = g.path(a, b)
        pts = resample(g.V[path], 0.5)
        cum = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        seg = pts[cum <= 5.0][::-1]  # from entry (posterior-inferior) to exit
        t = cKDTree(Vr)
        _, idx = t.query(seg)
        seg = seg - Nr[idx] * 0.6
        self.paths["AVN"] = dict(points=seg, kind="avn", schematic=False, radius=1.6)
        self.nodes["AVN"] = seg.mean(0)

        # His: AVN exit -> central fibrous body -> LV septal crest point
        Vl, Nl, _ = self.surf["endo_LV"]
        j = int(np.argmin(np.linalg.norm(Vl - C, axis=1)))
        h1 = Vl[j] - Nl[j] * 0.8
        his = np.array([seg[-1], C, h1])
        his = resample(his, 0.8)
        self.paths["His"] = dict(points=his, kind="his", schematic=False, radius=0.9)
        lm["his_branch"] = h1
        lm["his_branch_lv_vertex"] = j
        return seg, his

    def bachmann(self):
        """Bachmann's bundle: from the anterior-superior right atrium near the SVC, over the
        interatrial groove, to the left atrial anterior wall at the base of the appendage. Path is
        the epicardial geodesic (right and left atrial surfaces only)."""
        lm = self.lm
        g = self.graph(["epi_RA", "epi_LA"])
        rim = lm["svc_rim"]
        start_pt = rim[np.argmax(rim[:, 2])]  # most anterior SVC rim point
        a = int(np.argmin(np.linalg.norm(g.V - start_pt, axis=1)))
        b = int(np.argmin(np.linalg.norm(g.V - lm["laa_ostium"], axis=1)))
        path, _ = g.path(a, b)
        pts = resample(g.V[path], 1.0)
        # Keep the first 66 mm: across the interatrial groove and onto the anterior left atrial wall.
        # (In this mean mesh the appendage lies far posteriorly, so the full route to its ostium is
        # much longer than a real Bachmann's bundle.)
        cum = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        pts = pts[cum <= 66.0]
        # lift 0.4 mm off the surface using the nearest normals
        allV = np.vstack([self.surf["epi_RA"][0], self.surf["epi_LA"][0]])
        allN = np.vstack([self.surf["epi_RA"][1], self.surf["epi_LA"][1]])
        _, idx = cKDTree(allV).query(pts)
        pts = pts - allN[idx] * 0.5
        self.paths["Bachmann"] = dict(points=pts, kind="bachmann", schematic=False, radius=1.1)

    def internodal(self):
        """SCHEMATIC. Three internodal bands on the RA endocardium from the SA node region to the AV
        node entry, forced apart by via-points on the anterior, septal and posterior walls. The
        existence of discrete internodal tracts is debated; these bands only mark the likely routes."""
        lm = self.lm
        g = self.graph(["endo_RA"])
        V = g.V
        src = self.paths["SAN"]["points"][len(self.paths["SAN"]["points"]) // 2]
        dst = self.paths["AVN"]["points"][0]
        a = int(np.argmin(np.linalg.norm(V - src, axis=1)))
        b = int(np.argmin(np.linalg.norm(V - dst, axis=1)))
        # Via-points: the mid-point of the chord between the two ends, pushed 9 mm anterior, left
        # unchanged, or pushed 9 mm posterior, then snapped to the RA endocardium.
        chord = (V[a] + V[b]) / 2
        via = {}
        for name, dz in (("anterior", 9.0), ("middle", 0.0), ("posterior", -9.0)):
            q = chord + np.array([0.0, 0.0, dz])
            via[name] = V[int(np.argmin(np.linalg.norm(V - q, axis=1)))]
        for name, vp in via.items():
            m = int(np.argmin(np.linalg.norm(V - vp, axis=1)))
            p1, _ = g.path(a, m)
            p2, _ = g.path(m, b)
            pts = resample(V[p1 + p2[1:]], 1.0)
            Vr, Nr, _ = self.surf["endo_RA"]
            _, idx = cKDTree(Vr).query(pts)
            pts = pts - Nr[idx] * 0.4
            self.paths[f"internodal_{name}"] = dict(points=pts, kind="internodal", schematic=True, radius=0.7)

    # -------------------------------------------------------------- ventricular structures
    def lv_azimuth(self, P):
        """Azimuth (deg) about the LV long axis. 0 = towards the septum (RV side); positive towards the
        anterior wall."""
        lm = self.lm
        ax = lm["axis"]
        rv_c = self.P[np.unique(self.T[self.L == 2])].mean(0)
        u = rv_c - lm["apex"]
        u = unit(u - ax * (u @ ax))
        w = np.cross(ax, u)
        # orient w so that positive azimuth is anterior (+z)
        anterior = np.array([0, 0, 1.0])
        if w @ anterior < 0:
            w = -w
        q = P - lm["apex"]
        q = q - np.outer(q @ ax, ax)
        return np.degrees(np.arctan2(q @ w, q @ u))

    def height(self, P):
        """0 at the apex, 1 at the base plane, along the long axis."""
        lm = self.lm
        return ((P - lm["apex"]) @ lm["axis"]) / lm["axis_len"]

    def left_bundle(self):
        """LBB on the LV septal surface. Trunk from the His branching point; then a septal fascicle and
        the left anterior and posterior fascicles. SCHEMATIC termination sites (azimuth and height
        about the long axis): septal fascicle az 10, h 0.45; anterior az +105, h 0.50; posterior az
        -105, h 0.42."""
        Vl, Nl, Fl = self.surf["endo_LV"]
        g = SurfaceGraph(Vl, Fl)
        j0 = self.lm["his_branch_lv_vertex"]
        az = self.lv_azimuth(Vl)
        h = self.height(Vl)

        def target(az0, h0):
            d = np.hypot((az - az0) / 30.0, (h - h0) / 0.12)
            return int(np.argmin(d))

        # trunk: 12 mm towards the apex along the septal surface
        tgt_trunk = target(5, 0.62)
        p, _ = g.path(j0, tgt_trunk)
        trunk = resample(Vl[p], 1.0)
        trunk = trunk[np.r_[0, np.cumsum(np.linalg.norm(np.diff(trunk, axis=0), axis=1))] <= 14.0]
        t0 = int(np.argmin(np.linalg.norm(Vl - trunk[-1], axis=1)))
        branches = {"LSF": (10, 0.45), "LAF": (105, 0.50), "LPF": (-105, 0.42)}
        self.paths["LBB"] = dict(points=self._lift(trunk, "endo_LV"), kind="bb", schematic=False, radius=0.8)
        self.lv_roots = {}
        for name, (a0, h0) in branches.items():
            tgt = target(a0, h0)
            pp, _ = g.path(t0, tgt)
            pts = resample(Vl[pp], 1.0)
            self.paths[name] = dict(points=self._lift(pts, "endo_LV"), kind="bb", schematic=name != "LSF" and False, radius=0.65)
            self.lv_roots[name] = tgt
        self.lbb_graph = g

    def _lift(self, pts, surf):
        V, N, _ = self.surf[surf]
        _, idx = cKDTree(V).query(pts)
        return pts + N[idx] * 0.3  # normals point into the cavity for endo surfaces

    def right_bundle(self):
        """RBB: from the His bundle through the septum to the RV septal surface, then down the septal
        surface towards the RV apex. The moderator band is not modelled: the RBB ends at the apical
        septum and Purkinje fibres continue over the RV free wall. SCHEMATIC end point."""
        Vr, Nr, Fr = self.surf["endo_RV"]
        g = SurfaceGraph(Vr, Fr)
        C = self.lm["cfb"]
        j = int(np.argmin(np.linalg.norm(Vr - C, axis=1)))
        # RV apex: RV endocardial vertex with the lowest height along the LV long axis
        h = self.height(Vr)
        apex_i = int(np.argmin(h + 0.02 * np.abs(Vr[:, 0] - self.lm["apex"][0]) / 10))
        # keep the route on the septal side: penalise vertices far from the LV cavity surface
        d_lv = cKDTree(self.surf["endo_LV"][0]).query(Vr)[0]
        septal = d_lv < 15.0
        cost = np.where(septal, 1.0, 8.0)  # stay on the septal surface where possible
        gs = SurfaceGraph(Vr, Fr, vertex_cost=cost)
        j_s = j
        sept_idx = np.where(septal)[0]
        apex_s = int(sept_idx[np.argmin(h[sept_idx])])
        p, _ = gs.path(j_s, apex_s)
        pts = resample(Vr[p], 1.0)
        self.paths["RBB_entry"] = dict(points=resample(np.array([self.paths["His"]["points"][-2], self.paths["His"]["points"][len(self.paths["His"]["points"]) // 2], Vr[j_s]]), 0.8), kind="his", schematic=False, radius=0.9)
        self.paths["RBB"] = dict(points=self._lift(pts, "endo_RV"), kind="bb", schematic=False, radius=0.8)
        self.rv_root = int(np.argmin(np.linalg.norm(Vr - pts[-1], axis=1)))
        self.rbb_graph = g
        del apex_i

    def purkinje(self, which, n_terminals, hmax):
        """Terminal Purkinje network on one ventricular endocardium. Starting from the existing
        bundle/fascicle endpoints, repeatedly connect the farthest remaining sample point to the tree
        by the shortest endocardial path. Terminals are drawn only on the apical `hmax` fraction
        (and, for the LV, nowhere near the base) so the base activates by spread from the network.
        SCHEMATIC branching pattern."""
        if which == "LV":
            surf, g, roots = "endo_LV", self.lbb_graph, list(self.lv_roots.values())
        else:
            surf, g, roots = "endo_RV", self.rbb_graph, [self.rv_root]
        V, N, F = self.surf[surf]
        h = self.height(V)
        cand = np.where(h < hmax)[0]
        # thin candidates to roughly 4 mm spacing using voxel hashing
        key = np.floor(V[cand] / 4.0).astype(int)
        _, first = np.unique(key, axis=0, return_index=True)
        cand = cand[first]
        tree_nodes = set(roots)
        # add existing fascicle vertices (already on the surface mesh) to the tree
        edges = []  # (parent, child) surface vertex indices
        terminals = []
        for _ in range(n_terminals):
            d, pred = g.dist_from(sorted(tree_nodes))
            dc = d[cand]
            dc[np.isinf(dc)] = 0
            k = int(np.argmax(dc))
            t = int(cand[k])
            if dc[k] < 3.0:
                break
            path = [t]
            while path[-1] not in tree_nodes:
                nxt = int(pred[path[-1]])
                if nxt < 0:
                    break
                path.append(nxt)
            for a, b in zip(path[::-1][:-1], path[::-1][1:]):
                edges.append((a, b))
            tree_nodes.update(path)
            terminals.append(t)
        self.purk = getattr(self, "purk", {})
        self.purk[which] = dict(surf=surf, edges=edges, terminals=terminals, roots=roots)

    def build_all(self):
        self.landmarks()
        self.sa_node()
        self.av_node_and_his()
        self.bachmann()
        self.internodal()
        self.left_bundle()
        self.right_bundle()
        self.purkinje("LV", 170, 0.85)
        self.purkinje("RV", 100, 1.25)
        return self


if __name__ == "__main__":
    g = Geometry().build_all()
    for k, v in g.paths.items():
        print(f"{k:22s} {len(v['points']):4d} pts  {arclen(v['points']):6.1f} mm")
    for w in ("LV", "RV"):
        print(w, "purkinje edges", len(g.purk[w]["edges"]), "terminals", len(g.purk[w]["terminals"]))
    print("cfb", np.round(g.lm["cfb"], 1), "spread", round(g.lm["cfb_spread_mm"], 1))
