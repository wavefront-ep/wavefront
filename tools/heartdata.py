"""Shared loaders for the conduction and activation tooling. All coordinates are in millimetres
in scene axes (+x patient left, +y superior, +z anterior), the same frame as heart.glb."""
import json
import struct
from pathlib import Path

import numpy as np
import pyvista as pv
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "public/heart/heart.glb"
RAW = ROOT / "assets/raw/average.vtk"


def raw_to_scene_mm(p):
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def load_glb(path=GLB):
    """Return {mesh name: (V mm float64, N float32, F int)}."""
    b = path.read_bytes()
    jl = struct.unpack("<I", b[12:16])[0]
    js = json.loads(b[20:20 + jl])
    blob = b[20 + jl + 8:]

    def acc(i):
        a = js["accessors"][i]
        v = js["bufferViews"][a["bufferView"]]
        dt = {5126: np.float32, 5125: np.uint32}[a["componentType"]]
        n = {"VEC3": 3, "SCALAR": 1}[a["type"]]
        return np.frombuffer(blob, dtype=dt, count=a["count"] * n, offset=v["byteOffset"]).reshape(-1, n)

    out = {}
    for m in js["meshes"]:
        p = m["primitives"][0]
        V = acc(p["attributes"]["POSITION"]).astype(np.float64) * 100.0
        N = acc(p["attributes"]["NORMAL"]).copy()
        F = acc(p["indices"]).reshape(-1, 3).astype(np.int64)
        out[m["name"]] = (V, N, F)
    return out


def load_tets():
    """Tetrahedral mesh: (points mm scene, tets (n,4), labels (n,), source grid)."""
    m = pv.read(RAW)
    cells = m.cells.reshape(-1, 5)[:, 1:]
    return raw_to_scene_mm(m.points), cells, np.asarray(m.cell_data["ID"]).astype(int), m


def merge_meshes(parts):
    """Combine several (V, F) meshes into one, welding vertices at identical positions."""
    Vs, Fs, off = [], [], 0
    for V, F in parts:
        Vs.append(V)
        Fs.append(F + off)
        off += len(V)
    V = np.vstack(Vs)
    F = np.vstack(Fs)
    key = np.round(V, 3)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    return uniq, inv.reshape(-1)[F]


class SurfaceGraph:
    """Edge graph over a triangle surface for geodesic paths."""

    def __init__(self, V, F, allowed_faces=None, vertex_cost=None):
        """vertex_cost: optional per-vertex multiplier (>=1); an edge costs the mean of its ends."""
        self.V = V
        F = F if allowed_faces is None else F[allowed_faces]
        e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        e = np.sort(e, axis=1)
        e = np.unique(e, axis=0)
        w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
        if vertex_cost is not None:
            w = w * 0.5 * (vertex_cost[e[:, 0]] + vertex_cost[e[:, 1]])
        n = len(V)
        self.A = coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
        self.used = np.unique(F)

    def path(self, a, b):
        d, pred = dijkstra(self.A, directed=False, indices=a, return_predecessors=True)
        out = [b]
        while out[-1] != a:
            nxt = pred[out[-1]]
            if nxt < 0:
                raise ValueError("no path")
            out.append(nxt)
        return out[::-1], d[b]

    def dist_from(self, sources):
        d, pred, _ = dijkstra(self.A, directed=False, indices=sources, min_only=True, return_predecessors=True)
        return d, pred


def nearest_vertex(V, p, subset=None):
    idx = np.arange(len(V)) if subset is None else np.asarray(subset)
    return int(idx[np.argmin(np.linalg.norm(V[idx] - p, axis=1))])
