// Structure catalogue: which glTF meshes exist, how they are grouped into layers,
// their resting colour, and the short functional note shown on selection.
// The notes are authored text and are listed in REVIEW.md for the reviewer.

export type LayerGroup = 'epicardium' | 'endocardium' | 'vessel' | 'valve' | 'conduction' | 'substrate';
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
  /** Key in conduction.json `paths` (or `purkinje`) that locates this structure. */
  pathKey?: string;
  /** Meshes highlighted together with this one. */
  family?: string;
  schematic?: boolean;
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
  conduction: '#EFD98F',
  slowPathway: '#DDBB66',
  accessory: '#C98170',
  ring: '#7C93A8',
  channel: '#566F85',
  scar: '#8C95A0',
  crista: '#A9C3B8',
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

const cs = (s: Omit<Structure, 'group' | 'color'> & { color?: string }): Structure => ({
  group: 'conduction',
  color: COLORS.conduction,
  ...s,
});

const conduction: Structure[] = [
  cs({
    mesh: 'cs_SAN', name: 'Sinoatrial node', pathKey: 'SAN', label: 'SA node',
    color: '#E6CB73',
    note: 'The dominant pacemaker: a crescent of specialised cells in the lateral wall of the right atrium where the superior vena cava enters, near the top of the crista terminalis. At rest it fires 60 to 100 times a minute, and its impulse spreads out to the surrounding atrial muscle.',
  }),
  cs({
    mesh: 'cs_Bachmann', name: "Bachmann's bundle (schematic)", pathKey: 'Bachmann', label: "Bachmann's bundle (schematic)", schematic: true,
    note: 'A band of atrial muscle crossing the anterior wall of the atria that carries the impulse quickly from the right atrium to the left atrium. The course drawn here is schematic.',
  }),
  ...(['anterior', 'middle', 'posterior'] as const).map((w) =>
    cs({
      mesh: `cs_internodal_${w}`, name: `Internodal pathway, ${w} (schematic)`, pathKey: `internodal_${w}`, family: 'internodal', schematic: true,
      label: w === 'middle' ? 'Internodal pathways (schematic)' : undefined,
      note: 'Preferential routes for the impulse from the sinus node towards the AV node. Whether discrete anatomical tracts exist is debated, so these bands are schematic and mark likely routes only.',
    }),
  ),
  cs({
    mesh: 'cs_AVN', name: 'AV node', pathKey: 'AVN', label: 'AV node', color: '#E6CB73',
    note: 'Lies on the right atrial septum at the apex of the triangle of Koch. It is the only normal electrical connection between atria and ventricles and conducts slowly, which delays the impulse long enough for the ventricles to fill (the PR interval). Its position is anchored to the valve planes; its shape is simplified.',
  }),
  cs({
    mesh: 'cs_His', name: 'His bundle', pathKey: 'His', label: 'His bundle',
    note: 'Continues from the AV node through the central fibrous body and reaches the crest of the muscular septum, where it divides into the right and left bundle branches.',
  }),
  cs({
    mesh: 'cs_RBB', name: 'Right bundle branch', pathKey: 'RBB', label: 'Right bundle branch', family: 'rbb',
    note: 'Runs down the right side of the interventricular septum towards the right ventricular apex, then spreads as Purkinje fibres through the right ventricle. The moderator band is not modelled, so the branch ends at the apical septum here.',
  }),
  cs({
    mesh: 'cs_RBB_entry', name: 'Right bundle branch', pathKey: 'RBB_entry', family: 'rbb',
    note: 'Runs down the right side of the interventricular septum towards the right ventricular apex, then spreads as Purkinje fibres through the right ventricle. The moderator band is not modelled, so the branch ends at the apical septum here.',
  }),
  cs({
    mesh: 'cs_LBB', name: 'Left bundle branch', pathKey: 'LBB', label: 'Left bundle branch',
    note: 'Fans out over the left side of the septum, just below the aortic valve, and divides into the left anterior and left posterior fascicles. A septal branch is also drawn.',
  }),
  cs({
    mesh: 'cs_LAF', name: 'Left anterior fascicle', pathKey: 'LAF', label: 'Left anterior fascicle', schematic: true,
    note: 'The branch of the left bundle that supplies the anterior and superior left ventricle. Its termination site is schematic.',
  }),
  cs({
    mesh: 'cs_LPF', name: 'Left posterior fascicle', pathKey: 'LPF', label: 'Left posterior fascicle', schematic: true,
    note: 'The branch of the left bundle that supplies the posterior and inferior left ventricle. Its termination site is schematic.',
  }),
  cs({
    mesh: 'cs_LSF', name: 'Left septal fascicle', pathKey: 'LSF', label: 'Left septal fascicle', schematic: true,
    note: 'A branch to the mid septum, present in many hearts. It starts the septal activation from the left side. Its termination site is schematic.',
  }),
  cs({
    mesh: 'cs_Purkinje_LV', name: 'Purkinje fibres, left ventricle', pathKey: 'LV', label: 'Purkinje fibres (schematic)', schematic: true, color: '#E9D182',
    note: 'Fine terminal fibres on the inner surface of the ventricle that conduct fast and hand the impulse to working muscle at many points at once, which keeps the QRS narrow. The branching pattern is schematic.',
  }),
  cs({
    mesh: 'cs_Purkinje_RV', name: 'Purkinje fibres, right ventricle', pathKey: 'RV', schematic: true, color: '#E9D182',
    note: 'Fine terminal fibres on the inner surface of the ventricle that conduct fast and hand the impulse to working muscle at many points at once, which keeps the QRS narrow. The branching pattern is schematic.',
  }),
];

const sub = (s: Omit<Structure, 'group' | 'schematic'> & { schematic?: boolean }): Structure => ({ group: 'substrate', schematic: true, ...s });

const apNote = (site: string) =>
  `An accessory pathway is an extra strand of muscle across the AV groove that bypasses the AV node. It conducts quickly and recovers slowly. This one is at the ${site}; pathways can also lie at the left free wall, posteroseptal, right free wall or anteroseptal sites. Drawn schematically.`;

const substrates: Structure[] = [
  sub({
    mesh: 'sub_slow_pathway', name: 'Slow AV nodal pathway (schematic)', pathKey: 'slow_pathway', label: 'Slow pathway (schematic)', color: COLORS.slowPathway,
    note: 'The slow pathway enters the AV node from the posteroseptal right atrium, near the coronary sinus. It conducts slowly and recovers quickly. With the faster AV node route (the fast pathway) it forms the two limbs of the AV nodal reentry circuit. Drawn schematically.',
  }),
  sub({ mesh: 'sub_ap_left_free_wall', name: 'Accessory pathway, left free wall (schematic)', pathKey: 'ap_left_free_wall', label: 'Accessory pathway (schematic)', color: COLORS.accessory, note: apNote('left free wall') }),
  sub({ mesh: 'sub_ap_right_free_wall', name: 'Accessory pathway, right free wall (schematic)', pathKey: 'ap_right_free_wall', label: 'Accessory pathway (schematic)', color: COLORS.accessory, note: apNote('right free wall') }),
  sub({ mesh: 'sub_ap_posteroseptal', name: 'Accessory pathway, posteroseptal (schematic)', pathKey: 'ap_posteroseptal', label: 'Accessory pathway (schematic)', color: COLORS.accessory, note: apNote('posteroseptal region') }),
  sub({ mesh: 'sub_ap_anteroseptal', name: 'Accessory pathway, anteroseptal (schematic)', pathKey: 'ap_anteroseptal', label: 'Accessory pathway (schematic)', color: COLORS.accessory, note: apNote('anteroseptal region') }),
  sub({
    mesh: 'sub_flutter_ring', name: 'Flutter circuit (schematic)', pathKey: 'sub_flutter_ring', label: 'Flutter circuit (schematic)', color: COLORS.ring,
    note: 'In typical atrial flutter a wavefront circulates counter-clockwise around the tricuspid annulus, about 300 times a minute. The circuit is drawn schematically on the atrial side of the annulus.',
  }),
  sub({
    mesh: 'sub_cti', name: 'Cavotricuspid isthmus', pathKey: 'sub_cti', label: 'Cavotricuspid isthmus', color: COLORS.channel, schematic: true,
    note: 'The narrow strip of right atrial muscle between the tricuspid annulus and the inferior vena cava. Conduction is slow here and the circuit must pass through it, which makes it the usual ablation target in typical flutter. Its position and extent are schematic.',
  }),
  sub({
    mesh: 'sub_crista', name: 'Crista terminalis (schematic)', pathKey: 'sub_crista', label: 'Crista terminalis (schematic)', color: COLORS.crista,
    note: 'A muscular ridge on the lateral wall of the right atrium running between the superior and inferior venae cavae. It separates the smooth posterior part of the atrium from the trabeculated anterior part. Its course here is schematic: the mesh has no ridge.',
  }),
  sub({
    mesh: 'sub_scar', name: 'Scar', pathKey: 'scar', label: 'Scar', color: COLORS.scar, schematic: true,
    note: 'Scar from an old infarct: dead muscle that does not conduct. Surviving strands of muscle through and around it can form slow channels, the substrate for ventricular tachycardia. Its position is schematic.',
  }),
  sub({
    mesh: 'sub_vt_circuit', name: 'Re-entry circuit (schematic)', pathKey: 'sub_vt_circuit', label: 'Re-entry circuit (schematic)', color: COLORS.ring,
    note: 'The impulse circulates around the scar, slowing in a protected channel and leaving at an exit site into normal muscle with each lap. The circuit is drawn schematically.',
  }),
  sub({
    mesh: 'sub_vt_channel', name: 'Slow channel through the scar (schematic)', pathKey: 'sub_vt_channel', label: 'Slow channel (schematic)', color: COLORS.channel,
    note: 'The protected, slowly conducting channel of surviving muscle through the scar, the critical part of the circuit and the usual ablation target. Drawn schematically.',
  }),
];

structures.push(...conduction, ...substrates);

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
