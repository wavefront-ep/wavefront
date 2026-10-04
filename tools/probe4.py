import numpy as np, sys
import build_conduction as bc
b=bc.Builder(); b.assemble()
pos=np.array(b.node_pos); cls=np.array(b.node_cls); reg=np.array(b.node_reg)
tissue=np.arange(len(pos))<b.n_tissue
IA=bc.KINDS.index('interatrial'); BB=bc.KINDS.index('bachmann')
def run(v, bb=True):
    bc.VEL_BY_KIND[IA]=v
    saved=b.edges
    if not bb: b.edges=[e for e in b.edges if e[3]!=BB]
    t=b.solve(); b.edges=saved
    la=t[tissue&(reg==3)]; ra=t[tissue&(reg==4)]
    xs=pos[tissue&(reg==3)]
    first=xs[np.argmin(la)]
    print(f'v_ia={v:5.2f} bb={bb!s:5}: RA {ra.min():.0f}-{ra.max():.0f}  LA {la.min():.0f}-{la.max():.0f}  LA first at {np.round(first)}')
for v in (0.1,0.05,0.03):
    run(v,True); run(v,False)
