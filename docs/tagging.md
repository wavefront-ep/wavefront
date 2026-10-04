# Region and conduction-class tagging (draft)

Source: Rodero et al. 2021, SSM average mesh (Zenodo 4593739, CC BY 4.0). Tetrahedral, 379,158 points, 1,766,006 tets, units mm.
Axes in the raw file (inferred from region centroids, not documented by the authors): +x = patient left, -y = anterior, +z = superior.
Label key is from the Zenodo record description; the numbering was cross-checked against region centroids.

| ID | Source label | Proposed region | Conduction class |
|---|---|---|---|
| 1 | LV myocardium | LV | working ventricular |
| 2 | RV myocardium | RV | working ventricular |
| 3 | LA myocardium | LA | working atrial |
| 4 | RA myocardium | RA | working atrial |
| 5 | Aorta wall | aorta | none (non-conducting) |
| 6 | Pulmonary artery wall | pulmonary trunk | none |
| 7 | Mitral valve plane | mitral annulus | annulus / insulator |
| 8 | Tricuspid valve plane | tricuspid annulus | annulus / insulator |
| 9 | Aortic valve plane | aortic valve | none |
| 10 | Pulmonary valve plane | pulmonary valve | none |
| 11 | LAA inlet | LAA ostium (cap) | cap, not tissue |
| 12-15 | LSPV, LIPV, RIPV, RSPV inlet | PV ostia (caps) | cap, not tissue |
| 16, 17 | SVC, IVC inlet | cavae (caps) | cap, not tissue |
| 18-24 | borders of 11-17 | ostial rims | working atrial (PV sleeves later) |

Not in the mesh, to be authored and reviewed separately: nodal tissue, His-Purkinje, scar, crista terminalis,
cavotricuspid isthmus, triangle of Koch, accessory pathways. These are tagged by region masks defined on the
authored detail layer, not by the source labels.
Mapping of 12-15 to specific veins (which is LSPV vs LIPV etc.) follows the source order and is not yet checked on the surface.
