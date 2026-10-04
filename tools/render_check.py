"""Developer check: render the conduction geometry over a translucent heart (not part of the app)."""
import sys
import numpy as np
import pyvista as pv
from conduction_geometry import Geometry

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
g = Geometry().build_all()
pv.OFF_SCREEN = True
COL = {"san": "red", "avn": "orange", "his": "gold", "bachmann": "blue", "internodal": "cyan", "bb": "green"}


def poly(points):
    pl = pv.PolyData(points)
    n = len(points)
    pl.lines = np.hstack([[n], np.arange(n)])
    return pl


views = {
    "anterior": ((0, 0, 400), (0, 1, 0)),
    "right": ((-400, 0, 0), (0, 1, 0)),
    "left": ((400, 0, 0), (0, 1, 0)),
    "posterior": ((0, 0, -400), (0, 1, 0)),
    "top": ((0, 400, 1), (0, 0, 1)),
}
for vname, (pos, up) in views.items():
    p = pv.Plotter(off_screen=True, window_size=(1100, 1000))
    for k in ("epi_RA", "epi_LA", "epi_RV", "epi_LV", "aorta", "pulmonary_trunk"):
        V, N, F = g.surf[k]
        m = pv.PolyData(V, np.hstack([np.full((len(F), 1), 3), F]).ravel())
        p.add_mesh(m, color="#d8b8b4", opacity=0.18, smooth_shading=True)
    for name, d in g.paths.items():
        p.add_mesh(poly(d["points"]), color=COL[d["kind"]], line_width=5 if d["kind"] != "internodal" else 3)
    for w, pk in g.purk.items():
        V = g.surf[pk["surf"]][0]
        pts = np.array([[V[a], V[b]] for a, b in pk["edges"]]).reshape(-1, 3)
        lines = pv.PolyData(pts)
        lines.lines = np.hstack([[2, 2 * i, 2 * i + 1] for i in range(len(pk["edges"]))])
        p.add_mesh(lines, color="purple", line_width=1.5)
    p.camera_position = [pos, (-8, 5, 0), up]
    p.screenshot(f"{OUT}/cs_{vname}.png")
    p.close()
print("done")
