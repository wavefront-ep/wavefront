// Structure catalogue: which glTF meshes exist, how they are grouped into layers,
// their resting colour, and the short functional note shown on selection.
// The notes are authored text and are listed in REVIEW.md for the reviewer.

export type LayerGroup = 'epicardium' | 'endocardium' | 'vessel' | 'valve';
export type Chamber = 'RA' | 'LA' | 'RV' | 'LV';

export interface Structure {
  mesh: string;
  name: string;
  group: LayerGroup;
  chamber?: Chamber;
  color: string;
  note: string;
  /** Anatomical landmark key in heart.json used to anchor the label. */
  landmark?: string;
  label?: string;
}

// Palette (SPEC section 8).
export const COLORS = {
  ventricle: '#E7C3C0',
  atrium: '#ECD0D2',
  endoVentricle: '#D9B0AD',
  endoAtrium: '#DDBBBE',
  cut: '#C99E9B',
  venous: '#B5C7D9',
  arterial: '#E9B3AC',
  valve: '#E9DFCB',
  highlight: '#8FB8AE',
};

const endo = (c: Chamber) => (c === 'RA' || c === 'LA' ? COLORS.endoAtrium : COLORS.endoVentricle);

const chamberNote: Record<Chamber, string> = {
  RA: 'Receives systemic venous blood from the superior and inferior venae cavae and the coronary sinus, and empties through the tricuspid valve into the right ventricle. The sinoatrial node lies in its wall at the junction with the superior vena cava.',
  LA: 'Receives oxygenated blood from the four pulmonary veins and empties through the mitral valve into the left ventricle. Muscle sleeves extend onto the pulmonary veins, the usual trigger sites in atrial fibrillation.',
  RV: 'Crescent-shaped and anterior, it wraps over the interventricular septum. It receives from the right atrium through the tricuspid valve and ejects through the pulmonary valve.',
  LV: 'Thick-walled and conical, it forms the apex and the left side of the interventricular septum. It receives through the mitral valve and ejects through the aortic valve.',
};

const chamberName: Record<Chamber, string> = {
  RA: 'Right atrium',
  LA: 'Left atrium',
  RV: 'Right ventricle',
  LV: 'Left ventricle',
};

const chambers: Structure[] = (['RA', 'LA', 'RV', 'LV'] as Chamber[]).flatMap((c) => {
  const atrial = c === 'RA' || c === 'LA';
  return [
    {
      mesh: `epi_${c}`,
      name: chamberName[c],
      group: 'epicardium' as const,
      chamber: c,
      color: atrial ? COLORS.atrium : COLORS.ventricle,
      note: chamberNote[c],
      landmark: c,
      label: chamberName[c],
    },
    {
      mesh: `endo_${c}`,
      name: `${chamberName[c]}, endocardial surface`,
      group: 'endocardium' as const,
      chamber: c,
      color: endo(c),
      note: `The inner lining of the ${chamberName[c].toLowerCase()}, seen when the wall is cut or made transparent. ${chamberNote[c]}`,
    },
  ];
});

const pv = (code: string, name: string, side: string): Structure => ({
  mesh: `vein_${code}`,
  name,
  group: 'vessel',
  color: COLORS.arterial,
  note: `One of four pulmonary veins carrying oxygenated blood to the left atrium; this is the ${side} vein. Pulmonary vein ostia are the target of isolation in atrial fibrillation ablation. Shown as a short stub; the veins are cut at the ostium in this model.`,
  landmark: code,
  label: name,
});

const structures: Structure[] = [
  ...chambers,
  {
    mesh: 'aorta',
    name: 'Aorta (ascending)',
    group: 'vessel',
    color: COLORS.arterial,
    note: 'Carries oxygenated blood from the left ventricle through the aortic valve. Only the ascending aorta is modelled, cut short.',
    landmark: 'aorta',
    label: 'Aorta',
  },
  {
    mesh: 'pulmonary_trunk',
    name: 'Pulmonary trunk',
    group: 'vessel',
    color: COLORS.venous,
    note: 'Carries deoxygenated blood from the right ventricle through the pulmonary valve. It lies anterior and to the left of the aorta. The right and left branches are not modelled.',
    landmark: 'pulmonary_trunk',
    label: 'Pulmonary trunk',
  },
  {
    mesh: 'vein_SVC',
    name: 'Superior vena cava',
    group: 'vessel',
    color: COLORS.venous,
    note: 'Returns blood from the head, neck and arms to the right atrium. The sinoatrial node sits where it joins the atrium. Shown as a short stub.',
    landmark: 'SVC',
    label: 'SVC',
  },
  {
    mesh: 'vein_IVC',
    name: 'Inferior vena cava',
    group: 'vessel',
    color: COLORS.venous,
    note: 'Returns blood from the lower body to the right atrium. The cavotricuspid isthmus runs between its orifice and the tricuspid annulus. Shown as a short stub.',
    landmark: 'IVC',
    label: 'IVC',
  },
  pv('RSPV', 'Right superior pulmonary vein', 'right superior'),
  pv('RIPV', 'Right inferior pulmonary vein', 'right inferior'),
  pv('LSPV', 'Left superior pulmonary vein', 'left superior'),
  pv('LIPV', 'Left inferior pulmonary vein', 'left inferior'),
  {
    mesh: 'valve_tricuspid',
    name: 'Tricuspid valve',
    group: 'valve',
    color: COLORS.valve,
    note: 'Guards the opening between the right atrium and right ventricle. Its septal annulus forms one border of the triangle of Koch. Drawn here as a closed plane, not as leaflets.',
    landmark: 'tricuspid',
    label: 'Tricuspid valve',
  },
  {
    mesh: 'valve_mitral',
    name: 'Mitral valve',
    group: 'valve',
    color: COLORS.valve,
    note: 'Guards the opening between the left atrium and left ventricle. Drawn here as a closed plane, not as leaflets.',
    landmark: 'mitral',
    label: 'Mitral valve',
  },
  {
    mesh: 'valve_aortic',
    name: 'Aortic valve',
    group: 'valve',
    color: COLORS.valve,
    note: 'Lies at the centre of the heart between the left ventricle and the aorta. Drawn here as a closed plane, not as cusps.',
    landmark: 'aortic',
    label: 'Aortic valve',
  },
  {
    mesh: 'valve_pulmonary',
    name: 'Pulmonary valve',
    group: 'valve',
    color: COLORS.valve,
    note: 'Lies anterior, superior and to the left, between the right ventricle and the pulmonary trunk. Drawn here as a closed plane, not as cusps.',
    landmark: 'pulmonary',
    label: 'Pulmonary valve',
  },
];

export const STRUCTURES = structures;
export const BY_MESH: Record<string, Structure> = Object.fromEntries(structures.map((s) => [s.mesh, s]));

export const CHAMBERS: { id: Chamber; name: string }[] = [
  { id: 'RA', name: chamberName.RA },
  { id: 'LA', name: chamberName.LA },
  { id: 'RV', name: chamberName.RV },
  { id: 'LV', name: chamberName.LV },
];

/** Labels for landmarks that are not whole structures. */
export const EXTRA_LABELS = [
  { landmark: 'apex', text: 'Apex', meshes: ['epi_LV'] },
  { landmark: 'LAA_ostium', text: 'Left atrial appendage', meshes: ['epi_LA'] },
];
