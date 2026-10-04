import { BY_MESH, CHAMBERS, Chamber, STRUCTURES } from '../data/structures';
import { TOUR } from '../data/tour';
import { ActivationEngine, ActivationResult } from '../engine/activation';
import { PaletteId } from '../engine/material';
import { CutMode, HeartScene, PlacedLabel } from '../scene/HeartScene';
import { VIEWS } from '../scene/views';
import { Ecg } from '../ecg/morphology';
import { Scenario } from '../scenarios/types';
import { PlayBar } from './playbar';
import { Vector3 } from 'three';

const svg = (d: string) => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${d}"/></svg>`;

const ICONS = {
  // Outline of a heart-like form: explore the anatomy.
  explore: svg('M10 17C5 13.5 3 10.5 3 7.8 3 5.6 4.7 4 6.6 4c1.4 0 2.6.8 3.4 2 .8-1.2 2-2 3.4-2C15.3 4 17 5.6 17 7.8c0 2.7-2 5.7-7 9.2Z'),
  // A flat trace with one excursion: arrhythmia mechanisms.
  mechanisms: svg('M2 11h4l1.5-5 3 9 1.7-4H18'),
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function buildApp(root: HTMLElement) {
  const app = el('div', 'app');
  root.appendChild(app);

  // ---------------------------------------------------------- rail
  const rail = el('nav', 'rail');
  rail.setAttribute('aria-label', 'Modes');
  rail.appendChild(el('div', 'mark', 'EP'));
  const railBtn = (icon: string, label: string) => {
    const b = el('button', 'rail-btn', `${icon}<span class="tip">${label}</span>`);
    b.setAttribute('aria-label', label);
    return b;
  };
  const explore = railBtn(ICONS.explore, 'Explore');
  explore.setAttribute('aria-current', 'true');
  const mech = railBtn(ICONS.mechanisms, 'Mechanisms (not yet available)');
  mech.setAttribute('aria-disabled', 'true');
  rail.append(explore, mech, el('div', 'spacer'));

  // Top bar: the three things a new visitor should find first, as words rather than icons.
  const topbar = el('header', 'topbar');
  const topBtn = (label: string) => {
    const b = el('button', 'top-btn', label);
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const tourBtn = topBtn('Guided tour');
  const cutBtn = topBtn('Cutaway');
  const layersBtn = topBtn('Layers and views');
  topbar.append(tourBtn, cutBtn, el('span', 'spacer'), layersBtn);

  // ---------------------------------------------------------- stage
  const stage = el('main', 'stage');
  stage.appendChild(topbar);
  const viewport = el('div', 'viewport');
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('class', 'overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const hoverLabel = el('div', 'hoverlabel');
  const lower = el('div', 'lower');
  const playBeat = el('button', 'primary', 'Play sinus beat');
  playBeat.disabled = true;
  const hint = el('div', 'hint', 'Drag to rotate. Scroll to zoom. Select a structure for its name.');
  lower.append(playBeat, hint);
  const loading = el('div', 'loading', 'Loading the heart');
  viewport.append(overlay, hoverLabel, lower, loading);
  stage.appendChild(viewport);

  // ---------------------------------------------------------- drawer
  const drawer = el('aside', 'drawer');
  drawer.setAttribute('aria-label', 'Layers, views and structure details');

  const secStructure = el('section', 'sec');
  secStructure.appendChild(el('h2', undefined, 'Structure'));
  const structBody = el('div');
  secStructure.appendChild(structBody);

  const secView = el('section', 'sec');
  secView.appendChild(el('h2', undefined, 'View'));
  const viewList = el('ul', 'list');
  secView.appendChild(viewList);

  const secLayers = el('section', 'sec');
  secLayers.appendChild(el('h2', undefined, 'Layers'));

  const secCut = el('section', 'sec');
  secCut.appendChild(el('h2', undefined, 'Cutaway'));

  const secCredit = el('section', 'sec');
  secCredit.appendChild(
    el('p', 'cap', 'Heart geometry: Rodero et al., PLoS Computational Biology 2021, average shape of a healthy-adult statistical model (CC BY 4.0). Surface extracted, smoothed and decimated for this viewer. Conduction system placement and activation are schematic.'),
  );
  secStructure.id = 'sec-structure';
  secCut.id = 'sec-cutaway';
  secLayers.id = 'sec-layers';
  secView.id = 'sec-view';
  const nav = el('nav', 'drawer-nav');
  nav.setAttribute('aria-label', 'Jump to section');
  const goTo = (id: string) => {
    const t = drawer.querySelector<HTMLElement>(`#${id}`)!;
    drawer.scrollTo({ top: t.offsetTop - 64, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  for (const [id, name] of [['sec-structure', 'Structure'], ['sec-cutaway', 'Cutaway'], ['sec-layers', 'Layers'], ['sec-view', 'View']]) {
    const b = el('button', undefined, name);
    b.addEventListener('click', () => goTo(id));
    nav.appendChild(b);
  }
  drawer.append(nav, secStructure, secCut, secLayers, secView, secCredit);

  // ---------------------------------------------------------- scene and bar
  const scene = new HeartScene(viewport);
  (window as any).epHeart = scene;
  viewport.insertBefore(scene.renderer.domElement, overlay);
  const bar = new PlayBar(scene);
  stage.appendChild(bar.root);
  app.append(rail, stage, drawer);

  // ---------------------------------------------------------- behaviour
  const setDrawer = (open: boolean) => {
    app.classList.toggle('drawer-open', open);
    layersBtn.setAttribute('aria-pressed', String(open));
  };
  layersBtn.addEventListener('click', () => setDrawer(!app.classList.contains('drawer-open')));
  cutBtn.addEventListener('click', () => {
    setDrawer(true);
    requestAnimationFrame(() => goTo('sec-cutaway'));
  });

  const showStructure = (mesh: string | null) => {
    structBody.innerHTML = '';
    const s = mesh ? BY_MESH[mesh] : null;
    if (!s) {
      structBody.appendChild(el('p', 'struct-empty', 'Select a structure on the heart.'));
      return;
    }
    structBody.appendChild(el('h3', 'struct-name', s.name));
    structBody.appendChild(el('p', 'struct-note', s.note));
    if (s.schematic) structBody.appendChild(el('p', 'struct-tag', 'Schematic: the drawn course or position is illustrative.'));
  };
  showStructure(null);

  scene.onSelect = (mesh) => {
    showStructure(mesh);
    if (mesh) setDrawer(true);
  };
  scene.onHover = (mesh, x, y) => {
    if (!mesh) return hoverLabel.classList.remove('on');
    hoverLabel.textContent = BY_MESH[mesh].name.replace(', endocardial surface', ' (inner surface)');
    hoverLabel.style.left = `${x}px`;
    hoverLabel.style.top = `${y}px`;
    hoverLabel.classList.add('on');
  };

  // views
  const viewBtns = new Map<string, HTMLButtonElement>();
  for (const v of VIEWS) {
    const li = el('li');
    const b = el('button', 'vbtn', `<span>${v.name}${v.note ? `<span class="nt">${v.note}</span>` : ''}</span><span class="k">${v.key}</span>`);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => scene.setView(v.id));
    li.appendChild(b);
    viewList.appendChild(li);
    viewBtns.set(v.id, b);
  }
  scene.onViewChange = (id) => viewBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));

  // layers
  const check = (text: string, checked: boolean, on: (v: boolean) => void, cls = 'row', kk?: string) => {
    const l = el('label', cls);
    const i = el('input');
    i.type = 'checkbox';
    i.checked = checked;
    i.addEventListener('change', () => on(i.checked));
    l.append(i, document.createTextNode(text));
    if (kk) l.appendChild(el('span', 'kk', kk));
    return { label: l, input: i };
  };
  const L = scene.layers;
  const epi = check('Epicardial surface', L.epicardium, (v) => ((L.epicardium = v), scene.applyLayers()));
  secLayers.appendChild(epi.label);
  const opacity = el('input');
  opacity.type = 'range';
  opacity.min = '0.1';
  opacity.max = '1';
  opacity.step = '0.01';
  opacity.value = String(L.epiOpacity);
  opacity.setAttribute('aria-label', 'Epicardial opacity');
  const opRow = el('div', 'slider-row', '<span>Opacity</span>');
  const opVal = el('span', undefined, '100%');
  opRow.appendChild(opVal);
  const setOpacity = (v: number) => {
    L.epiOpacity = v;
    opacity.value = String(v);
    opVal.textContent = `${Math.round(v * 100)}%`;
    scene.applyLayers();
  };
  opacity.addEventListener('input', () => setOpacity(Number(opacity.value)));
  const opWrap = el('div');
  opWrap.style.padding = '0 0 8px 24px';
  opWrap.append(opacity, opRow);
  secLayers.appendChild(opWrap);

  const chamberInputs = new Map<Chamber, HTMLInputElement>();
  for (const c of CHAMBERS) {
    const ch = check(c.name, true, (v) => ((L.chambers[c.id] = v), scene.applyLayers()), 'row sub');
    chamberInputs.set(c.id, ch.input);
    secLayers.appendChild(ch.label);
  }
  secLayers.appendChild(check('Great vessels', L.vessels, (v) => ((L.vessels = v), scene.applyLayers())).label);
  secLayers.appendChild(check('Valves', L.valves, (v) => ((L.valves = v), scene.applyLayers())).label);

  // conduction system: the surface turns see-through so the structures read, and a list lets
  // students jump to each one (the finest fibres are too thin to click).
  let opacityBeforeConduction: number | null = null;
  const csList = el('ul', 'list cs-list');
  csList.hidden = true;
  const csItems = STRUCTURES.filter((s) => s.group === 'conduction' && s.label && s.mesh !== 'cs_RBB_entry');
  for (const s of csItems) {
    const li = el('li');
    const b = el('button', 'vbtn', `<span>${s.name}</span>`);
    b.addEventListener('click', () => {
      scene.select(s.mesh);
      scene.focusStructure(s.mesh);
    });
    li.appendChild(b);
    csList.appendChild(li);
  }
  const setConduction = (v: boolean, auto = true) => {
    L.conduction = v;
    csList.hidden = !v;
    cond.input.checked = v;
    if (scene.cut.mode === 'fourChamber' && scene.cut.offset === (v ? 0 : CONDUCTION_CUT_OFFSET)) {
      scene.setCut('fourChamber', defaultOffset('fourChamber'));
      showOffset(defaultOffset('fourChamber'));
    }
    if (auto) {
      if (v && L.epiOpacity > 0.9) {
        opacityBeforeConduction = L.epiOpacity;
        setOpacity(0.35);
      } else if (!v && opacityBeforeConduction !== null) {
        if (L.epiOpacity < 0.5) setOpacity(opacityBeforeConduction);
        opacityBeforeConduction = null;
      }
    }
    scene.applyLayers();
    scene.relabel();
  };
  const cond = check('Conduction system', L.conduction, (v) => setConduction(v));
  secLayers.appendChild(cond.label);
  secLayers.appendChild(csList);

  const labels = check('Labels', L.labels, (v) => setLabels(v), 'row', 'L');
  secLayers.appendChild(labels.label);

  // activation display
  const dispTitle = el('p', 'subhead', 'Activation display');
  const dispSeg = el('div', 'seg');
  const styleBtns = new Map<string, HTMLButtonElement>();
  for (const [id, name] of [['live', 'Live wave'], ['map', 'Activation map']] as const) {
    const b = el('button', 'vbtn', `<span>${name}</span>`);
    b.setAttribute('aria-pressed', String(id === 'live'));
    b.addEventListener('click', () => setStyle(id));
    dispSeg.appendChild(b);
    styleBtns.set(id, b);
  }
  const palSeg = el('div', 'seg');
  const palBtns = new Map<PaletteId, HTMLButtonElement>();
  for (const [id, name] of [['safe', 'Colour-blind safe'], ['carto', 'CARTO-style (red early, purple late)']] as const) {
    const b = el('button', 'vbtn', `<span>${name}</span>`);
    b.setAttribute('aria-pressed', String(id === 'safe'));
    b.addEventListener('click', () => setPalette(id));
    palSeg.appendChild(b);
    palBtns.set(id, b);
  }
  palSeg.hidden = true;
  const scopeSeg = el('div', 'seg');
  const scopeBtns = new Map<string, HTMLButtonElement>();
  for (const [id, name] of [['all', 'Whole heart'], ['atria', 'Atria only'], ['ventricles', 'Ventricles only']] as const) {
    const b = el('button', 'vbtn', `<span>${name}</span>`);
    b.setAttribute('aria-pressed', String(id === 'all'));
    b.addEventListener('click', () => setScope(id));
    scopeSeg.appendChild(b);
    scopeBtns.set(id, b);
  }
  scopeSeg.hidden = true;
  const scopeTitle = el('p', 'subhead sm', 'Range');
  const palTitle = el('p', 'subhead sm', 'Colours');
  scopeTitle.hidden = true;
  palTitle.hidden = true;
  secLayers.append(dispTitle, dispSeg, scopeTitle, scopeSeg, palTitle, palSeg);
  secLayers.appendChild(
    el('p', 'cap', 'Blue-grey marks vessels carrying blood towards the lungs and the venae cavae; coral marks the aorta and pulmonary veins. This is a convention, not a measurement.'),
  );

  let palette: PaletteId = 'safe';
  let mapRange: [number, number] = [0, 260];
  let ranges: Record<string, [number, number]> = { all: [0, 260], atria: [0, 110], ventricles: [150, 260] };
  const setScope = (id: string) => {
    mapRange = ranges[id];
    scene.setMapRange(mapRange[0], mapRange[1]);
    scopeBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
    bar.setStyleState(scene.style, mapRange, palette);
  };
  const setStyle = (s: 'live' | 'map') => {
    scene.setStyle(s);
    styleBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === s)));
    palSeg.hidden = s !== 'map';
    scopeSeg.hidden = s !== 'map';
    scopeTitle.hidden = s !== 'map';
    palTitle.hidden = s !== 'map';
    bar.setStyleState(s, mapRange, palette);
  };
  const setPalette = (p: PaletteId) => {
    palette = p;
    scene.setPalette(p);
    palBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === p)));
    bar.setStyleState(scene.style, mapRange, palette);
  };
  bar.onStyle = setStyle;

  // cutaway
  const cutBtns = new Map<CutMode, HTMLButtonElement>();
  const seg = el('div', 'seg');
  const cuts: [CutMode, string][] = [
    ['off', 'None'],
    ['fourChamber', 'Four-chamber cut'],
    ['shortAxis', 'Short-axis cut'],
  ];
  const cutSlider = el('input');
  cutSlider.type = 'range';
  cutSlider.min = '-0.5';
  cutSlider.max = '0.5';
  cutSlider.step = '0.005';
  cutSlider.value = '0';
  cutSlider.disabled = true;
  cutSlider.setAttribute('aria-label', 'Cut plane position');
  const cutVal = el('span', undefined, '0 mm');
  // The plane through the apex and both AV valve centres lies 2 to 24 mm behind most of the
  // conduction system, so with that layer on it starts 26 mm further forward to keep it in view.
  const CONDUCTION_CUT_OFFSET = -0.26;
  const defaultOffset = (mode: CutMode) => (mode === 'fourChamber' && L.conduction ? CONDUCTION_CUT_OFFSET : 0);
  const showOffset = (v: number) => {
    cutSlider.value = String(v);
    cutVal.textContent = `${v > 0 ? '+' : ''}${Math.round(v * 100)} mm`;
  };
  const setCut = (mode: CutMode, moveCamera = true) => {
    const off = defaultOffset(mode);
    scene.setCut(mode, off, moveCamera);
    showOffset(off);
    cutSlider.disabled = mode === 'off';
    cutBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === mode)));
  };
  for (const [mode, name] of cuts) {
    const b = el('button', 'vbtn', `<span>${name}</span>`);
    b.setAttribute('aria-pressed', String(mode === 'off'));
    b.addEventListener('click', () => setCut(mode));
    seg.appendChild(b);
    cutBtns.set(mode, b);
  }
  cutSlider.addEventListener('input', () => {
    const v = Number(cutSlider.value);
    scene.setCut(scene.cut.mode, v);
    cutVal.textContent = `${v > 0 ? '+' : ''}${Math.round(v * 100)} mm`;
  });
  const cutRow = el('div', 'slider-row', '<span>Plane position</span>');
  cutRow.appendChild(cutVal);
  secCut.append(seg, cutSlider, cutRow);
  secCut.appendChild(
    el('p', 'cap', 'The four-chamber plane passes through the apex and the centres of the mitral and tricuspid valves. Valves are drawn as closed planes. With the conduction system on, the plane starts 26 mm further forward so the nodes and bundles stay in view.'),
  );

  // labels overlay
  const setLabels = (v: boolean) => {
    L.labels = v;
    labels.input.checked = v;
    scene.relabel();
  };
  scene.onLabels = (placed: PlacedLabel[]) => {
    overlay.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const p of placed) {
      const ln = document.createElementNS(ns, 'line');
      ln.setAttribute('x1', String(p.anchor.x));
      ln.setAttribute('y1', String(p.anchor.y));
      ln.setAttribute('x2', String(p.x));
      ln.setAttribute('y2', String(p.y));
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(p.anchor.x));
      dot.setAttribute('cy', String(p.anchor.y));
      dot.setAttribute('r', '2');
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(p.side === 'left' ? p.x - 6 : p.x + 6));
      t.setAttribute('y', String(p.y + 4));
      t.setAttribute('text-anchor', p.side === 'left' ? 'end' : 'start');
      t.textContent = p.text;
      overlay.append(ln, dot, t);
    }
  };

  // hint fades after first interaction
  const dismissHint = () => hint.classList.add('gone');
  viewport.addEventListener('pointerdown', dismissHint, { once: true });
  viewport.addEventListener('wheel', dismissHint, { once: true, passive: true });
  window.addEventListener('keydown', dismissHint, { once: true });

  // ---------------------------------------------------------- simulation
  let engine: ActivationEngine | null = null;
  let scenario: Scenario | null = null;
  let result: ActivationResult | null = null;

  const syncControls = () => {
    epi.input.checked = L.epicardium;
    opacity.value = String(L.epiOpacity);
    opVal.textContent = `${Math.round(L.epiOpacity * 100)}%`;
    cond.input.checked = L.conduction;
    csList.hidden = !L.conduction;
    labels.input.checked = L.labels;
    cutBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === scene.cut.mode)));
    cutSlider.disabled = scene.cut.mode === 'off';
  };

  const openBeat = () => {
    if (!result) return;
    endTour();
    scene.select(null, true);
    lower.hidden = true;
    bar.show('beat');
    bar.setStyleState(scene.style, mapRange, palette);
    setConduction(true);
    scene.setTime(0);
    scene.play();
    app.classList.add('bar-open');
  };
  const closeBar = () => {
    scene.pause();
    scene.select(null, true);
    bar.hide();
    lower.hidden = false;
    app.classList.remove('bar-open');
    tourBtn.setAttribute('aria-pressed', 'false');
    tourStep = -1;
  };
  bar.onClose = () => {
    closeBar();
    if (scene.style === 'map') setStyle('live');
  };
  playBeat.addEventListener('click', openBeat);

  // guided tour
  let tourStep = -1;
  const applyTourStep = (i: number) => {
    const s = TOUR[i];
    tourStep = i;
    scene.pause();
    L.epicardium = true;
    if (s.epiOpacity !== undefined) {
      opacityBeforeConduction = null;
      setOpacity(s.epiOpacity);
    }
    if (s.conduction !== undefined) setConduction(s.conduction, false);
    if (s.labels !== undefined) setLabels(s.labels);
    if (s.cut !== undefined) {
      const off = s.cut === 'fourChamber' && (s.conduction ?? L.conduction) ? CONDUCTION_CUT_OFFSET : 0;
      scene.setCut(s.cut, off, false);
      showOffset(off);
    }
    if (s.style) setStyle(s.style);
    else if (scene.style === 'map') setStyle('live');
    scene.select(s.select ?? null, true);
    if (s.time !== undefined) scene.setTime(s.time);
    const target = s.focus ? scene.pathPoint(s.focus) : null;
    scene.setCamera(new Vector3(...s.dir), s.distance, target);
    syncControls();
    bar.setTour(i, TOUR.length, s.title, s.text);
    scene.applyLayers();
    scene.relabel();
  };
  const startTour = () => {
    if (!result) return;
    lower.hidden = true;
    tourBtn.setAttribute('aria-pressed', 'true');
    bar.show('tour');
    app.classList.add('bar-open');
    applyTourStep(0);
  };
  const endTour = () => {
    if (tourStep < 0) return;
    tourStep = -1;
    bar.hide();
    tourBtn.setAttribute('aria-pressed', 'false');
    app.classList.remove('bar-open');
    lower.hidden = false;
  };
  bar.onTourStep = (d) => {
    const n = tourStep + d;
    if (n >= TOUR.length) return bar.onClose();
    if (n >= 0) applyTourStep(n);
  };
  tourBtn.addEventListener('click', () => (tourStep >= 0 ? bar.onClose() : startTour()));

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'range')) return;
    const view = VIEWS.find((v) => v.key === e.key);
    if (view) return scene.setView(view.id);
    const k = e.key.toLowerCase();
    if (k === 'l') setLabels(!L.labels);
    else if (k === 'h') app.classList.toggle('chrome-hidden');
    else if (k === 'escape') scene.select(null);
    else if (e.key === ' ' && result && t?.tagName !== 'BUTTON') {
      e.preventDefault();
      if (!bar.visible) openBeat();
      else if (bar.currentMode === 'beat') scene.togglePlay();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      if (bar.currentMode === 'beat') bar.stepEvent(d);
      else if (bar.currentMode === 'tour') bar.onTourStep(d);
    }
  });

  /** Called once the graph is loaded and the scenario has been solved. */
  const attachSimulation = (
    eng: ActivationEngine,
    sc: Scenario,
    res: ActivationResult,
    events: { id: string; label: string; t: number; caption: string; ecg?: string }[],
    scopes: Record<string, [number, number]>,
    ecg: Ecg | null,
  ) => {
    engine = eng;
    scenario = sc;
    result = res;
    scene.playback.duration = sc.period_ms;
    ranges = scopes;
    mapRange = ranges.all;
    scene.setMapRange(mapRange[0], mapRange[1]);
    bar.setEvents(events, sc.period_ms);
    if (ecg) bar.setEcg(ecg);
    playBeat.disabled = false;
  };

  return { scene, app, loading, chamberInputs, attachSimulation, get engine() { return engine; }, get scenario() { return scenario; } };
}
