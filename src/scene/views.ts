import { Vector3 } from 'three';

export interface ViewPreset {
  id: string;
  name: string;
  key: string;
  /** Direction from the heart centre towards the camera (scene axes: +x left, +y up, +z anterior). */
  dir: Vector3;
  note?: string;
}

const d = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

// Superior and inferior use a tiny anterior/posterior offset so the orbit controls keep
// a defined "up": anterior is at the top of the screen in both.
export const VIEWS: ViewPreset[] = [
  { id: 'anterior', name: 'Anterior', key: '1', dir: d(0, 0, 1) },
  { id: 'posterior', name: 'Posterior', key: '2', dir: d(0, 0, -1) },
  { id: 'left', name: 'Left lateral', key: '3', dir: d(1, 0, 0) },
  { id: 'right', name: 'Right lateral', key: '4', dir: d(-1, 0, 0) },
  { id: 'superior', name: 'Superior', key: '5', dir: d(0, 1, -0.02) },
  { id: 'inferior', name: 'Inferior', key: '6', dir: d(0, -1, 0.02) },
  // Cath-lab projections are approximate: rotation about the long axis of the patient only,
  // no cranial or caudal angulation.
  { id: 'rao', name: 'RAO 30°', key: '7', dir: d(-Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)), note: 'approximate' },
  { id: 'lao', name: 'LAO 45°', key: '8', dir: d(Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)), note: 'approximate' },
];

export const VIEW_BY_ID: Record<string, ViewPreset> = Object.fromEntries(VIEWS.map((v) => [v.id, v]));
