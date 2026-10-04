import numpy as np, sys
import build_conduction as bc
b=bc.Builder(); b.assemble(); t=b.solve()
pos=np.array(b.node_pos); cls=np.array(b.node_cls); reg=np.array(b.node_reg)
tissue=np.arange(len(t))<b.n_tissue
v=tissue&(cls==1)
g=b.g
print('apex',np.round(g.lm['apex'],0),'base',np.round(g.lm['base'],0))
def h(p): return g.height(p)
idx=np.where(v)[0]
late=idx[np.argsort(t[idx])[-60:]]
print('latest 60 ventricular nodes: mean pos',np.round(pos[late].mean(0),0),'height',np.round(h(pos[late]).mean(),2),'regions',np.bincount(reg[late]))
for lo,hi in [(0,.2),(.2,.4),(.4,.6),(.6,.8),(.8,1.2)]:
    s=v&(h(pos)>=lo)&(h(pos)<hi); 
    if s.sum(): print(f'height {lo:.1f}-{hi:.1f}: n={s.sum()} first {t[s].min():.0f} median {np.median(t[s]):.0f} last {t[s].max():.0f}')
