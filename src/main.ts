import './style.css';
import { ActivationEngine } from './engine/activation';
import sinus from './scenarios/sinus_rhythm.json';
import { validateScenario } from './scenarios/types';
import { buildEcg } from './ecg/morphology';
import { buildApp } from './ui/app';

const root = document.getElementById('app')!;
const ui = buildApp(root);
const BASE = import.meta.env.BASE_URL;

async function start() {
  await ui.scene.load(`${BASE}heart/heart.glb`, `${BASE}heart/heart.json`);
  ui.loading.classList.add('gone');

  // Conduction system and activation. The anatomy above is already usable while this loads.
  const engine = await ActivationEngine.create(BASE);
  await ui.scene.loadConduction(`${BASE}heart/conduction.glb`, engine);

  const scenario = sinus as unknown;
  validateScenario(scenario);
  const named = engine.graph.meta.named;
  const result = await engine.solve([scenario.stimuli.map((s) => ({ node: named[s.site], time: s.time_ms }))]);
  ui.scene.setActivation(result);

  const events = scenario.events.flatMap((e) => {
    const t = engine.eventTime(e.at, result);
    return t === null ? [] : [{ id: e.id, label: e.label, t, caption: e.caption, ecg: e.ecg }];
  });
  // Colour-map ranges (ms), rounded outwards to the 10 ms isochrone spacing.
  const span = (a: number | null, b: number | null): [number, number] => [Math.floor((a ?? 0) / 10) * 10, Math.ceil((b ?? 0) / 10) * 10];
  const aFirst = engine.eventTime({ firstTissue: 'atrial' }, result);
  const aLast = engine.eventTime({ lastTissue: 'atrial' }, result);
  const vFirst = engine.eventTime({ firstTissue: 'ventricular' }, result);
  const vLast = engine.eventTime({ lastTissue: 'ventricular' }, result);
  const scopes = { all: span(0, vLast), atria: span(aFirst, aLast), ventricles: span(vFirst, vLast) };
  const ecg =
    scenario.ecg && aFirst !== null && aLast !== null && vFirst !== null && vLast !== null
      ? buildEcg(scenario.ecg.template, { aFirst, aLast, vFirst, vLast, apdVentricular: engine.constants.apd_ventricular }, scenario.period_ms)
      : null;
  ui.attachSimulation(engine, scenario, result, events, scopes, ecg);
  (window as any).epEngine = { engine, result, events };
}

start().catch((err) => {
  ui.loading.classList.remove('gone');
  ui.loading.textContent = 'The heart model could not be loaded.';
  console.error(err);
});
