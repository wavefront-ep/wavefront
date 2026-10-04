"""Arrhythmia substrates placed on the mesh (Phase 3).

Everything here is derived from the labelled mesh (valve orifices, vein ostia, chamber surfaces) and is
SCHEMATIC where marked. Coordinates: mm, scene axes (+x patient left, +y superior, +z anterior).

Produces, into the Geometry object:
  g.paths       extra tubes (kind 'sub'), drawn only when a scenario asks for them
  g.sub         structure definitions: ring orders, exit sites, scar centre and so on
"""
import numpy as np
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

from conduction_geometry import resample, unit
from heartdata import SurfaceGraph


def boundary_loops(F):
    """Ordered vertex loops formed by boundary edges (edges used by exactly one face)."""
    e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    key = np.sort(e, axis=1)
    uniq, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    bnd = uniq[cnt == 1]
    nbr = {}
    for a, b in bnd:
        nbr.setdefault(int(a), []).append(int(b))
        nbr.setdefault(int(b), []).append(int(a))
    seen, loops = set(), []
    for s in nbr:
        if s in seen:
            continue
        loop, cur, prev = [s], s, None
        seen.add(s)
        while True:
            nxt = [x for x in nbr[cur] if x != prev and x not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    return loops


def closed_resample(pts, step):
    pts = np.vstack([pts, pts[:1]])
    r = resample(pts, step)
    return r[:-1]


class Substrates:
    def __init__(self, g):
        self.g = g
        self.sub = {}

    # ------------------------------------------------------------------ annuli
    def _loop_near(self, surf, centre):
        V, N, F = self.g.surf[surf]
        loops = [l for l in boundary_loops(F) if len(l) > 12]
        best = min(loops, key=lambda l: np.linalg.norm(V[l].mean(0) - centre))
        return V, N, best

    def annuli(self):
        g = self.g
        M = g.M
        cen = {k: M[f"valve_{k}"][0].mean(0) for k in ("tricuspid", "mitral", "aortic")}
        out = {}
        for name, surf, valve in (("tri_a", "endo_RA", "tricuspid"), ("tri_v", "endo_RV", "tricuspid"),
                                  ("mit_a", "endo_LA", "mitral"), ("mit_v", "endo_LV", "mitral")):
            V, N, loop = self._loop_near(surf, cen[valve])
            out[name] = (V, N, loop)
        self.ann = out
        self.centres = cen

    def _ring(self, key, lift=0.4):
        V, N, loop = self.ann[key]
        pts = V[loop] + N[loop] * lift
        return pts

    # ------------------------------------------------------------------ accessory pathways
    def accessory_pathways(self):
        """Four candidate accessory pathway sites on the AV groove (SPEC 4.2). Each is a short straight
        tube from the atrial side of the annulus to the ventricular side, 0.5 mm radius."""
        g = self.g
        tri_a, tri_v = self._ring("tri_a"), self._ring("tri_v")
        mit_a, mit_v = self._ring("mit_a"), self._ring("mit_v")
        ao = self.centres["aortic"]

        def pick(ring, score):
            return int(np.argmax(score(ring)))

        sites = {}
        i = pick(mit_a, lambda r: r[:, 0])  # most left-lateral point of the mitral annulus
        sites["left_free_wall"] = (mit_a, mit_v, i)
        i = pick(tri_a, lambda r: -r[:, 0])  # most right-lateral point of the tricuspid annulus
        sites["right_free_wall"] = (tri_a, tri_v, i)
        # posteroseptal: where the mitral annulus comes closest to the tricuspid annulus
        d, _ = cKDTree(tri_a).query(mit_a)
        sites["posteroseptal"] = (mit_a, mit_v, int(np.argmin(d)))
        # anteroseptal: tricuspid annulus point closest to the aortic valve
        i = int(np.argmin(np.linalg.norm(tri_a - ao, axis=1)))
        sites["anteroseptal"] = (tri_a, tri_v, i)
        self.sub["ap_sites"] = {}
        for name, (ra, rv, i) in sites.items():
            a = ra[i]
            j = int(np.argmin(np.linalg.norm(rv - a, axis=1)))
            v = rv[j]
            pts = np.linspace(a, v, max(3, int(np.linalg.norm(v - a) / 1.2) + 1))
            g.paths[f"ap_{name}"] = dict(points=pts, kind="sub", schematic=True, radius=0.55)
            self.sub["ap_sites"][name] = dict(atrial=a.tolist(), ventricular=v.tolist())

    # ------------------------------------------------------------------ flutter ring
    def flutter_ring(self):
        """Counter-clockwise macro-reentry ring along the atrial side of the tricuspid annulus. The
        cavotricuspid isthmus (CTI) is the stretch of ring nearest the IVC ostium. SCHEMATIC: the real
        circuit lies a little away from the annulus and the isthmus is a band between annulus and IVC."""
        g = self.g
        ring = closed_resample(self._ring("tri_a", 0.3), 1.5)
        ivc = g.lm["ivc_centre"]
        i_ivc = int(np.argmin(np.linalg.norm(ring - ivc, axis=1)))
        # orientation: through the isthmus the impulse travels from the lateral wall to the septum (+x)
        tang = ring[(i_ivc + 1) % len(ring)] - ring[i_ivc - 1]
        if tang[0] < 0:
            ring = ring[::-1]
            i_ivc = int(np.argmin(np.linalg.norm(ring - ivc, axis=1)))
        n = len(ring)
        # isthmus arc: 16 mm on each side of the point nearest the IVC
        step = np.linalg.norm(np.diff(ring, axis=0), axis=1).mean()
        half = int(round(16.0 / step))
        arc = [(i_ivc + k) % n for k in range(-half, half + 1)]
        start = arc[0]
        ring = np.roll(ring, -start, axis=0)  # ring[0] is the lateral end of the isthmus
        arc_idx = list(range(0, len(arc)))
        g.paths["sub_flutter_ring"] = dict(points=np.vstack([ring, ring[:1]]), kind="sub", schematic=True, radius=0.8)
        g.paths["sub_cti"] = dict(points=ring[arc_idx], kind="sub", schematic=True, radius=1.3)
        self.sub["flutter_ring"] = dict(points=ring, cti=arc_idx, length_mm=float(np.linalg.norm(np.diff(np.vstack([ring, ring[:1]]), axis=0), axis=1).sum()))

    # ------------------------------------------------------------------ crista terminalis
    def crista(self):
        """Crista terminalis: epicardial-to-endocardial ridge on the lateral right atrium between the SVC
        and IVC. Placed as the endocardial geodesic from the lateral SVC rim point to the lateral IVC rim
        point, kept in the lateral half. SCHEMATIC position (the mesh has no ridge)."""
        g = self.g
        V, N, F = g.surf["endo_RA"]
        gr = SurfaceGraph(V, F)
        rim = g.lm["svc_rim"]
        a = int(np.argmin(np.linalg.norm(V - rim[np.argmin(rim[:, 0])], axis=1)))
        ivc = g.surf["vein_IVC"][0]
        near = ivc[cKDTree(V).query(ivc)[0] < 2.5]
        b = int(np.argmin(np.linalg.norm(V - near[np.argmin(near[:, 0])], axis=1)))
        # keep the route lateral: penalise vertices on the septal (+x) side
        cost = 1.0 + np.clip((V[:, 0] - V[a, 0]) / 15.0, 0, 6)
        gl = SurfaceGraph(V, F, vertex_cost=cost)
        p, _ = gl.path(a, b)
        pts = resample(V[p] + N[p] * 0.5, 1.0)
        g.paths["sub_crista"] = dict(points=pts, kind="sub", schematic=True, radius=1.6)
        self.sub["crista"] = dict(points=pts)

    # ------------------------------------------------------------------ AV node dual pathways
    def slow_pathway(self):
        """Slow AV nodal pathway: from the posteroseptal right atrium (towards the IVC and coronary sinus
        region) along the septum to the lower end of the AV node. The fast pathway is the compact AV node
        route already in the model."""
        g = self.g
        Vr, Nr, Fr = g.surf["endo_RA"]
        gr = SurfaceGraph(Vr, Fr)
        avn = g.paths["AVN"]["points"]
        exit_pt = avn[-1]
        entry = avn[0]
        i_e = int(np.argmin(np.linalg.norm(Vr - entry, axis=1)))
        i_i = int(np.argmin(np.linalg.norm(Vr - g.lm["ivc_centre"], axis=1)))
        p, _ = gr.path(i_e, i_i)
        pts = resample(Vr[p], 0.5)
        cum = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        far = pts[np.argmin(np.abs(cum - 10.0))]
        i_f = int(np.argmin(np.linalg.norm(Vr - far, axis=1)))
        i_x = int(np.argmin(np.linalg.norm(Vr - exit_pt, axis=1)))
        p2, _ = gr.path(i_f, i_x)
        chain = resample(Vr[p2], 1.0)
        _, idx = cKDTree(Vr).query(chain)
        chain = chain - Nr[idx] * 0.9
        chain[-1] = exit_pt  # joins the lower end of the AV node
        g.paths["slow_pathway"] = dict(points=chain, kind="sub", schematic=True, radius=0.9)

    # ------------------------------------------------------------------ scar and VT circuit
    def scar(self, az=-60.0, h=0.5, core_r=11.0, ring_r=18.0):
        """Post-infarct scar on the inferior left ventricular wall (SCHEMATIC position) with a re-entry
        circuit around it: a ring in the border zone, a slowed stretch (the protected channel, 35% of
        the ring) and a single exit site where the circuit hands the impulse to normal muscle."""
        g = self.g
        V, N, F = g.surf["endo_LV"]
        gl = SurfaceGraph(V, F)
        azs, hs = g.lv_azimuth(V), g.height(V)
        d = np.hypot((azs - az) / 30.0, (hs - h) / 0.12)
        c = int(np.argmin(d))
        dist = dijkstra(gl.A, directed=False, indices=c)
        # scar patch (display): faces entirely within core_r of the centre
        inside = dist < core_r
        faces = F[inside[F].all(axis=1)]
        used, inv = np.unique(faces.ravel(), return_inverse=True)
        self.sub["scar_patch"] = dict(V=V[used] + N[used] * 0.15, N=N[used], F=inv.reshape(-1, 3))
        # ring in the border zone, ordered by angle about the centre in the tangent plane
        cand = np.where(np.abs(dist - ring_r) < 1.0)[0]
        n0 = N[c]
        u = unit(np.cross(n0, [0.0, 1.0, 0.0]) if abs(n0[1]) < 0.9 else np.cross(n0, [1.0, 0.0, 0.0]))
        w = np.cross(n0, u)
        ang = np.arctan2((V[cand] - V[c]) @ w, (V[cand] - V[c]) @ u)
        order = np.argsort(ang)
        ring = closed_resample(V[cand[order]] + N[cand[order]] * 0.3, 1.5)
        n = len(ring)
        slow = int(round(0.35 * n))
        g.paths["sub_vt_circuit"] = dict(points=np.vstack([ring, ring[:1]]), kind="sub", schematic=True, radius=0.8)
        g.paths["sub_vt_channel"] = dict(points=ring[: slow + 1], kind="sub", schematic=True, radius=1.3)
        self.sub["scar"] = dict(centre=V[c].tolist(), core_r=core_r, ring=ring, slow=slow, exit=slow)

    def build_all(self):
        self.annuli()
        self.accessory_pathways()
        self.flutter_ring()
        self.crista()
        self.slow_pathway()
        self.scar()
        return self


if __name__ == "__main__":
    from conduction_geometry import Geometry, arclen

    g = Geometry().build_all()
    s = Substrates(g).build_all()
    for k, v in g.paths.items():
        if k.startswith(("ap_", "sub_", "slow")):
            print(f"{k:22s} {len(v['points']):4d} pts {arclen(v['points']):6.1f} mm")
    print("flutter ring length", round(s.sub["flutter_ring"]["length_mm"], 1), "mm; CTI points", len(s.sub["flutter_ring"]["cti"]))
    print("scar centre", np.round(s.sub["scar"]["centre"], 1), "ring pts", len(s.sub["scar"]["ring"]))
    print("AP sites", {k: np.round(v["atrial"], 0).tolist() for k, v in s.sub["ap_sites"].items()})
