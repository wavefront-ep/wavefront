import sys, numpy as np, pyvista as pv
from conduction_geometry import Geometry
from substrates import Substrates
OUT=sys.argv[1]
g=Geometry().build_all(); s=Substrates(g).build_all()
pv.OFF_SCREEN=True
def poly(points):
    pl=pv.PolyData(points); n=len(points); pl.lines=np.hstack([[n],np.arange(n)]); return pl
cols={'ap_left_free_wall':'red','ap_right_free_wall':'red','ap_posteroseptal':'red','ap_anteroseptal':'red','sub_flutter_ring':'blue','sub_cti':'cyan','sub_crista':'green','slow_pathway':'orange','sub_vt_circuit':'purple','sub_vt_channel':'magenta','AVN':'gold','His':'gold','SAN':'brown'}
for vname,(pos,up) in {'anterior':((0,0,400),(0,1,0)),'right':((-400,0,0),(0,1,0)),'left':((400,0,0),(0,1,0)),'inferior':((0,-400,1),(0,0,1)),'posterior':((0,0,-400),(0,1,0))}.items():
    p=pv.Plotter(off_screen=True,window_size=(1000,900))
    for k in ('epi_RA','epi_LA','epi_RV','epi_LV','aorta','pulmonary_trunk'):
        V,N,F=g.surf[k]; p.add_mesh(pv.PolyData(V,np.hstack([np.full((len(F),1),3),F]).ravel()),color='#d8b8b4',opacity=0.15)
    sp=s.sub['scar_patch']; p.add_mesh(pv.PolyData(sp['V'],np.hstack([np.full((len(sp['F']),1),3),sp['F']]).ravel()),color='gray')
    for k,c in cols.items():
        if k in g.paths: p.add_mesh(poly(g.paths[k]['points']),color=c,line_width=6)
    p.camera_position=[pos,(-8,5,0),up]; p.screenshot(f'{OUT}/sub_{vname}.png'); p.close()
