// Schematic lead II strip generated from the activation times of the model (SPEC 6: "generate it
// from event times using morphology templates"). It is an illustration of timing, not a recording:
// amplitudes are fixed, the T wave comes from a uniform action potential duration, and nothing here
// is derived from a body-surface model.

export interface EcgTimes {
  /** First and last atrial activation (P wave), ms. */
  aFirst: number;
  aLast: number;
  /** First and last ventricular activation (QRS), ms. */
  vFirst: number;
  vLast: number;
  /** Ventricular action potential duration, ms (sets the QT interval). */
  apdVentricular: number;
}

export interface Ecg {
  /** One sample per millisecond, arbitrary units (R wave about 1). */
  samples: Float32Array;
  p: [number, number];
  qrs: [number, number];
  t: [number, number];
  pr: [number, number];
  qt: [number, number];
}

const g = (x: number, mu: number, sigma: number) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);

export type EcgTemplate = 'normal_sinus';

export function buildEcg(template: EcgTemplate, tm: EcgTimes, duration: number): Ecg {
  if (template !== 'normal_sinus') throw new Error(`unknown ECG template ${template}`);
  const { aFirst, aLast, vFirst, vLast } = tm;
  const D = vLast - vFirst;
  const pMid = (aFirst + aLast) / 2;
  const pSig = (aLast - aFirst) / 5;
  // QT from QRS onset to T end: QRS plus the action potential plateau, so a longer APD lengthens QT.
  const tEnd = vFirst + D + tm.apdVentricular * 0.9;
  const tPeak = tEnd - 60;
  const samples = new Float32Array(duration + 1);
  for (let x = 0; x <= duration; x++) {
    let y = 0.14 * g(x, pMid, pSig);
    y += -0.12 * g(x, vFirst + 0.1 * D, 0.05 * D); // Q
    y += 1.0 * g(x, vFirst + 0.38 * D, 0.09 * D); // R
    y += -0.26 * g(x, vFirst + 0.68 * D, 0.08 * D); // S
    y += 0.3 * g(x, tPeak, x < tPeak ? 42 : 28); // T, rising slowly and falling faster
    samples[x] = y;
  }
  return {
    samples,
    p: [aFirst, aLast],
    qrs: [vFirst, vLast],
    t: [vLast + 25, tEnd],
    pr: [aFirst, vFirst],
    qt: [vFirst, tEnd],
  };
}
