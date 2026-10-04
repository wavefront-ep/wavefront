import numpy as np
import build_conduction as bc
b=bc.Builder(); b.assemble(); t=b.solve(); g=b.g
pos=np.array(b.node_pos); cls=np.array(b.node_cls); reg=np.array(b.node_reg)
tissue=np.arange(len(t))<b.n_tissue
lv=np.where(tissue&(reg==1))[0]
late=lv[np.argsort(t[lv])[-80:]]
print('LV latest 80: t range',t[late].min().round(),t[late].max().round(),'mean pos',np.round(pos[late].mean(0)),'height',g.height(pos[late]).mean().round(2),'azimuth deg (0 septum,+ anterior)',np.round(np.median(g.lv_azimuth(pos[late]))))
early=lv[np.argsort(t[lv])[:80]]
print('LV earliest 80: mean pos',np.round(pos[early].mean(0)),'height',g.height(pos[early]).mean().round(2),'azimuth',np.round(np.median(g.lv_azimuth(pos[early]))))
# epicardium vs endocardium timing: distance to LV cavity surface
from scipy.spatial import cKDTree
endo=cKDTree(g.surf['endo_LV'][0]); d,_=endo.query(pos[lv])
for lo,hi in [(0,2),(2,6),(6,10),(10,20)]:
    s=(d>=lo)&(d<hi)&(g.height(pos[lv])<0.7)
    if s.sum(): print(f'LV mid/apical depth {lo}-{hi} mm from endocardium: median t {np.median(t[lv][s]):.0f}')
rv=np.where(tissue&(reg==2))[0]
late=rv[np.argsort(t[rv])[-80:]]
print('RV latest 80: mean pos',np.round(pos[late].mean(0)),'height',g.height(pos[late]).mean().round(2),'t',t[late].min().round(),t[late].max().round())
print('septum check: LV septal-ish nodes (azimuth |a|<25, h 0.3-0.7) median',np.median(t[lv][(abs(g.lv_azimuth(pos[lv]))<25)&(g.height(pos[lv])>.3)&(g.height(pos[lv])<.7)]).round())
print('LV free wall anterior(az 60-130) median',np.median(t[lv][(g.lv_azimuth(pos[lv])>60)&(g.lv_azimuth(pos[lv])<130)&(g.height(pos[lv])<.7)]).round(),
      ' posterior(az -130..-60)',np.median(t[lv][(g.lv_azimuth(pos[lv])<-60)&(g.lv_azimuth(pos[lv])>-130)&(g.height(pos[lv])<.7)]).round())
