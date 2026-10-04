import type { CutMode } from '../scene/HeartScene';

/** Guided tour of the healthy heart and its conduction system. Each step moves the camera and
 *  switches layers; the text is written for a student seeing the structure for the first time. */
export interface TourStep {
  title: string;
  text: string;
  /** Direction from the target to the camera (scene axes: +x patient left, +y up, +z anterior). */
  dir: [number, number, number];
  distance: number;
  /** Look at the middle of a conduction path (key in conduction.json) instead of the heart centre. */
  focus?: string;
  cut?: CutMode;
  conduction?: boolean;
  epiOpacity?: number;
  labels?: boolean;
  /** Structure to highlight (mesh name). */
  select?: string;
  /** Playhead in ms; the beat stays paused here. */
  time?: number;
  style?: 'live' | 'map';
}

export const TOUR: TourStep[] = [
  {
    title: 'The heart from the front',
    text: 'The right ventricle forms most of the front surface; the left ventricle forms the apex, which points down and to the patient’s left. The right atrium is on the viewer’s left, and the aorta and pulmonary trunk leave from the top.',
    dir: [0, 0, 1],
    distance: 3.1,
    cut: 'off',
    conduction: false,
    epiOpacity: 1,
    labels: true,
    time: 0,
    style: 'live',
  },
  {
    title: 'Inside the chambers',
    text: 'A four-chamber cut shows the atria above and the ventricles below, separated by the AV valves (drawn as closed planes) and by the septa. The left ventricular wall is the thickest.',
    dir: [0, 0, 1],
    distance: 2.9,
    cut: 'fourChamber',
    conduction: false,
    epiOpacity: 1,
    labels: true,
    time: 0,
  },
  {
    title: 'The pacemaker',
    text: 'The sinoatrial node lies in the lateral wall of the right atrium, where the superior vena cava enters. It is the normal pacemaker and starts every beat.',
    dir: [-1, 0.25, 0.35],
    distance: 1.7,
    focus: 'SAN',
    cut: 'off',
    conduction: true,
    epiOpacity: 0.3,
    labels: true,
    select: 'cs_SAN',
    time: 0,
  },
  {
    title: 'Across the atria',
    text: 'The impulse spreads through the atrial muscle. Bachmann’s bundle carries it quickly across to the left atrium. The internodal bands are schematic and mark likely routes only.',
    dir: [-0.1, 0.55, 1],
    distance: 2.6,
    cut: 'off',
    conduction: true,
    epiOpacity: 0.3,
    labels: true,
    time: 38,
  },
  {
    title: 'The AV node',
    text: 'The AV node, on the right side of the septum, is the only normal link between atria and ventricles. It conducts slowly, which holds the impulse back so the ventricles can fill first.',
    dir: [-0.9, 0.2, 0.6],
    distance: 1.5,
    focus: 'AVN',
    cut: 'off',
    conduction: true,
    epiOpacity: 0.25,
    labels: true,
    select: 'cs_AVN',
    time: 95,
  },
  {
    title: 'His bundle and bundle branches',
    text: 'The His bundle passes through the central fibrous body and divides at the top of the muscular septum. The left bundle branch fans over the left side of the septum; the right bundle branch runs down its right side.',
    dir: [0.7, 0.1, 0.7],
    distance: 2.0,
    focus: 'His',
    cut: 'off',
    conduction: true,
    epiOpacity: 0.25,
    labels: true,
    select: 'cs_His',
    time: 140,
  },
  {
    title: 'Purkinje fibres and the ventricles',
    text: 'Purkinje fibres deliver the impulse to the inner surface of both ventricles at once. The septum activates first, from left to right, then the apex and free walls, from inside to outside, with the base last.',
    dir: [0.35, -0.05, 1],
    distance: 2.9,
    cut: 'off',
    conduction: true,
    epiOpacity: 0.4,
    labels: true,
    select: 'cs_Purkinje_LV',
    time: 185,
  },
  {
    title: 'The whole beat as a map',
    text: 'Colour now shows when each region activates, in milliseconds after the sinus node fires. The lines are 10 ms apart. The atria finish within about 100 ms; the ventricles follow after the pause at the AV node.',
    dir: [0, 0, 1],
    distance: 3.1,
    cut: 'off',
    conduction: false,
    epiOpacity: 1,
    labels: true,
    time: 0,
    style: 'map',
  },
];
