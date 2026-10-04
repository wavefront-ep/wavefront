import './style.css';
import { ActivationEngine } from './engine/activation';
import { ScenarioLoader } from './ui/loader';
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

  const loader = new ScenarioLoader(engine);
  const sinus = await loader.get('sinus_rhythm'); // solved up front so the first beat starts at once
  ui.scene.setActivation(sinus.result, sinus.constants);
  ui.attachScenarios(loader);
  (window as any).epOpen = ui.openScenario;
  (window as any).epEngine = { engine, loader, result: sinus.result, events: sinus.events };
}

start().catch((err) => {
  ui.loading.classList.remove('gone');
  ui.loading.textContent = 'The heart model could not be loaded.';
  console.error(err);
});
