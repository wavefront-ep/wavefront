import numpy as np
import build_conduction as bc
b=bc.Builder(); b.assemble(); g=b.g
pos=np.array(b.node_pos); cls=np.array(b.node_cls); reg=np.array(b.node_reg)
tissue=np.arange(len(pos))<b.n_tissue
def stats(t,label):
    la=t[tissue&(reg==3)]; ra=t[tissue&(reg==4)]
    print(f'{label}: RA {ra.min():.0f}-{ra.max():.0f}  LA {la.min():.0f}-{la.max():.0f}  atrial total {t[tissue&(cls==0)].max():.0f}')
t=b.solve(); stats(t,'with Bachmann')
# remove Bachmann coupling edges
keep=[e for e in b.edges if e[3]!=bc.KINDS.index('bachmann')]
saved=b.edges; b.edges=keep; t2=b.solve(); stats(t2,'no Bachmann  '); b.edges=saved
# remove all RA-LA direct contact edges (class 0, regions 3-4)
keep=[e for e in b.edges if not (e[3]==0 and e[0]<b.n_tissue and e[1]<b.n_tissue and reg[e[0]]!=reg[e[1]])]
b.edges=keep; t3=b.solve(); stats(t3,'no RA-LA contact (BB only)'); b.edges=saved
# ventricular septum: LV side vs RV side
from scipy.spatial import cKDTree
lv=g.surf['endo_LV'][0]; rvS=g.surf['endo_RV'][0]
d_lv=cKDTree(lv).query(rvS)[0]
sept_rv=rvS[d_lv<12]
tt=cKDTree(pos[tissue&(cls==1)]); idx=np.where(tissue&(cls==1))[0]
_,nn=tt.query(sept_rv); print('RV septal surface median t',np.median(t[idx[nn]]).round(),' | LV septal surface (endo_LV nearest RV) median',np.median(t[idx[tt.query(lv[cKDTree(rvS).query(lv)[0]<12])[1]]]).round())
