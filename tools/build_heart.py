"""Build the viewer heart asset from the Rodero et al. (2021) SSM average mesh.

Input : assets/raw/average.vtk  (Zenodo 4593739, CC BY 4.0, tetrahedral, mm)
Output: public/heart/heart.glb  (one named mesh per structure)
        public/heart/heart.json (sidecar: region key, groups, landmarks, bounds)

Steps: tetra boundary surface -> split into 5 connected shells (epicardium +
4 chamber cavities) -> light smoothing -> decimation -> carry the source label
to each decimated face -> split into named meshes.

Scene axes (Three.js, y-up): +x patient left, +y superior, +z anterior, 1 unit = 100 mm.
The raw file is +x left, -y anterior, +z superior (inferred from region centroids).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pyvista as pv
from scipy.spatial import cKDTree
import fast_simplification

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/raw/average.vtk"
OUT = ROOT / "public/heart"
SCALE = 0.01
TARGET_FACES = 120_000  # roughly 60k vertices total

# Source label key (Zenodo record description).
LABELS = {
    1: "LV myocardium", 2: "RV myocardium", 3: "LA myocardium", 4: "RA myocardium",
    5: "Aorta wall", 6: "Pulmonary artery wall",
    7: "Mitral valve plane", 8: "Tricuspid valve plane", 9: "Aortic valve plane", 10: "Pulmonary valve plane",
    11: "LAA inlet", 12: "LSPV inlet", 13: "LIPV inlet", 14: "RIPV inlet", 15: "RSPV inlet",
    16: "SVC inlet", 17: "IVC inlet",
}
# Border labels (18-24) were matched to inlets by centroid, not by the order in the
# record text: border = inlet + 7 (18 LAA, 19 LSPV, 20 LIPV, 21 RIPV, 22 RSPV, 23 SVC, 24 IVC).
BORDER_OF = {18: 11, 19: 12, 20: 13, 21: 14, 22: 15, 23: 16, 24: 17}

VEIN = {12: "LSPV", 13: "LIPV", 14: "RIPV", 15: "RSPV", 16: "SVC", 17: "IVC"}
VALVE = {7: "mitral", 8: "tricuspid", 9: "aortic", 10: "pulmonary"}


def mesh_name(shell, label):
    """Name of the output mesh a face belongs to; None to drop it."""
    label = BORDER_OF.get(label, label)
    if label in VALVE:
        return f"valve_{VALVE[label]}"
    if label in VEIN:
        return f"vein_{VEIN[label]}"
    if shell == 0:  # outer shell
        return {1: "epi_LV", 2: "epi_RV", 3: "epi_LA", 4: "epi_RA", 5: "aorta",
                6: "pulmonary_trunk", 11: "epi_LA"}.get(label)
    endo = {1: None, 2: None, 3: "endo_LA", 4: "endo_RA"}
    if label == 11:
        return "endo_LA"
    if label in (1, 2):  # ventricular cavity shells: shell id decides LV vs RV
        return "endo_RV" if shell == 1 else "endo_LV"
    return endo.get(label)


def load_shells():
    m = pv.read(SRC)
    ids = m.cell_data["ID"]
    s = m.extract_surface(algorithm=None).triangulate()
    lab = ids[s.cell_data["vtkOriginalCellIds"]].astype(np.int32)
    comp = s.connectivity("all").cell_data["RegionId"]
    # Shell numbering by size: 0 outer, then identify cavities by their valve labels.
    shells = {}
    for r in np.unique(comp):
        l = lab[comp == r]
        has = set(np.unique(l).tolist())
        if len(l) < 1000:
            continue  # tiny internal void
        if 5 in has:
            shells[0] = r
        elif 8 in has and 10 in has:
            shells[1] = r  # RV cavity: tricuspid + pulmonary valve planes
        elif 7 in has and 9 in has:
            shells[2] = r  # LV cavity: mitral + aortic
        elif 8 in has and 16 in has:
            shells[3] = r  # RA cavity: tricuspid + SVC inlet
        elif 7 in has and 11 in has:
            shells[4] = r  # LA cavity: mitral + LAA inlet
    assert sorted(shells) == [0, 1, 2, 3, 4], shells
    return s, lab, comp, shells


def to_scene(p):
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1) * SCALE


def main():
    s, lab, comp, shells = load_shells()
    total = s.n_cells
    parts = {}  # mesh name -> list of (verts, faces, normals)
    for shell, r in shells.items():
        sel = comp == r
        sub = s.extract_cells(np.where(sel)[0]).extract_surface(algorithm=None).triangulate()
        face_lab = lab[sel]
        # centroids of original faces for label transfer
        orig_c = sub.cell_centers().points
        sub = sub.clean()
        sub = sub.smooth_taubin(n_iter=20, pass_band=0.1)
        reduction = 1.0 - (TARGET_FACES * sub.n_cells / total) / sub.n_cells
        v = np.asarray(sub.points, dtype=np.float32)
        f = sub.faces.reshape(-1, 4)[:, 1:].astype(np.int32)
        v2, f2 = fast_simplification.simplify(v, f, target_reduction=float(reduction))
        dec = pv.PolyData(v2, np.hstack([np.full((len(f2), 1), 3), f2]).ravel())
        # fast_simplification can leave some triangles wound the wrong way, which the viewer
        # would cull as holes. Make winding consistent, then orient the whole shell to agree
        # with the original tetrahedral boundary (outward from tissue).
        dec = dec.compute_normals(cell_normals=True, point_normals=False, split_vertices=False,
                                  auto_orient_normals=False, consistent_normals=True)
        orig_n = sub.compute_normals(cell_normals=True, point_normals=False).cell_data["Normals"]
        _, nn0 = cKDTree(sub.cell_centers().points).query(dec.cell_centers().points)
        agree = np.einsum("ij,ij->i", np.asarray(dec.cell_data["Normals"]), orig_n[nn0])
        print(f"  shell {shell}: face orientation agreement {np.mean(agree > 0):.4f} before fix", file=sys.stderr)
        f2 = dec.faces.reshape(-1, 4)[:, 1:].astype(np.int32)
        if np.mean(agree > 0) < 0.5:
            f2 = f2[:, ::-1]
        dec = pv.PolyData(dec.points, np.hstack([np.full((len(f2), 1), 3), f2]).ravel())
        dec = dec.compute_normals(cell_normals=False, point_normals=True, split_vertices=False,
                                  auto_orient_normals=False, consistent_normals=False)
        v2 = np.asarray(dec.points, dtype=np.float32)
        nrm = np.asarray(dec.point_data["Normals"], dtype=np.float32)
        # nearest original face -> label
        d_c = dec.cell_centers().points
        _, nn = cKDTree(orig_c).query(d_c)
        dl = face_lab[nn]
        for label in np.unique(dl):
            name = mesh_name(shell, int(label))
            if name is None:
                continue
            sel_f = f2[dl == label]
            parts.setdefault(name, []).append((v2.astype(np.float32), sel_f, nrm))
        print(f"shell {shell}: {sub.n_cells} -> {len(f2)} faces", file=sys.stderr)

    meshes = {}
    for name, lst in parts.items():
        vs, fs, ns, off = [], [], [], 0
        for v, f, n in lst:
            used, inv = np.unique(f.ravel(), return_inverse=True)
            vs.append(v[used]); ns.append(n[used])
            fs.append(inv.reshape(-1, 3) + off); off += len(used)
        V = to_scene(np.vstack(vs)).astype(np.float32)
        N = np.vstack(ns)
        N = np.stack([N[:, 0], N[:, 2], -N[:, 1]], axis=1).astype(np.float32)
        F = np.vstack(fs).astype(np.uint32)
        meshes[name] = (V, N, F)

    # Landmarks from the labelled tetrahedra (centroids in scene units).
    m = pv.read(SRC)
    ids = m.cell_data["ID"]
    cc = m.cell_centers().points
    def cen(label):
        return to_scene(cc[ids == label].mean(0, keepdims=True))[0].tolist()
    lv = cc[ids == 1]
    base = cc[np.isin(ids, [7, 9])].mean(0)
    apex_raw = lv[np.argmax(np.linalg.norm(lv - base, axis=1))]
    landmarks = {
        "apex": to_scene(apex_raw[None])[0].tolist(),
        "LAA_ostium": cen(11), "LSPV": cen(12), "LIPV": cen(13), "RIPV": cen(14), "RSPV": cen(15),
        "SVC": cen(16), "IVC": cen(17),
        "mitral": cen(7), "tricuspid": cen(8), "aortic": cen(9), "pulmonary": cen(10),
        "RA": cen(4), "LA": cen(3), "RV": cen(2), "LV": cen(1), "aorta": cen(5), "pulmonary_trunk": cen(6),
    }

    write_glb(OUT / "heart.glb", meshes)
    allv = np.vstack([v for v, _, _ in meshes.values()])
    sidecar = {
        "source": "Rodero et al. 2021, PLoS Comput Biol, SSM average mesh, Zenodo 4593739, CC BY 4.0. Surface extracted, smoothed, decimated; modified.",
        "units": "1 scene unit = 100 mm; +x patient left, +y superior, +z anterior",
        "labels": LABELS,
        "meshes": {k: {"vertices": int(len(v)), "faces": int(len(f))} for k, (v, _, f) in meshes.items()},
        "landmarks": landmarks,
        "bounds": [allv.min(0).tolist(), allv.max(0).tolist()],
    }
    (OUT / "heart.json").write_text(json.dumps(sidecar, indent=1))
    print("vertices", sum(len(v) for v, _, _ in meshes.values()), "faces", sum(len(f) for _, _, f in meshes.values()))


def write_glb(path, meshes):
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = bytearray()
    views, accs, gm, nodes = [], [], [], []

    def add(data, target, ctype, count, typ, mn=None, mx=None):
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": data.nbytes, "target": target})
        blob.extend(data.tobytes())
        a = {"bufferView": len(views) - 1, "componentType": ctype, "count": count, "type": typ}
        if mn is not None:
            a["min"], a["max"] = mn, mx
        accs.append(a)
        return len(accs) - 1

    for i, (name, (V, N, F)) in enumerate(sorted(meshes.items())):
        p = add(V, 34962, 5126, len(V), "VEC3", V.min(0).tolist(), V.max(0).tolist())
        n = add(N, 34962, 5126, len(N), "VEC3")
        ix = add(F.ravel(), 34963, 5125, F.size, "SCALAR")
        gm.append({"name": name, "primitives": [{"attributes": {"POSITION": p, "NORMAL": n}, "indices": ix, "mode": 4}]})
        nodes.append({"name": name, "mesh": i})
    gltf = {
        "asset": {"version": "2.0", "generator": "ep_heart/tools/build_heart.py"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": gm, "accessors": accs, "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(blob) % 4:
        blob.append(0)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    path.write_bytes(out)
    print(f"wrote {path} ({len(out)/1e6:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
