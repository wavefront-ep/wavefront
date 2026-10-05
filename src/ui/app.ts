import { BY_MESH, CHAMBERS, Chamber, STRUCTURES } from '../data/structures';
import { TOUR } from '../data/tour';
import { PaletteId } from '../engine/material';
import { CutMode, HeartScene, PlacedLabel } from '../scene/HeartScene';
import { VIEWS } from '../scene/views';
import { GROUPS, Loaded, SCENARIOS, ScenarioLoader } from './loader';
import { PlayBar } from './playbar';
import { Vector3 } from 'three';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function buildApp(root: HTMLElement) {
  const app = el('div', 'app');
  root.appendChild(app);

  // Top bar: the three things a new visitor should find first, as words rather than icons.
  const topbar = el('header', 'topbar');
  const topBtn = (label: string) => {
    const b = el('button', 'top-btn', label);
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const stepBtn = (n: number, label: string) => {
    const b = el('button', 'top-btn', `<span class="top-n">${n}</span>${label}`);
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  // The intended route through the tool: the tour, then one normal beat, then the arrhythmias.
  const tourBtn = stepBtn(1, 'Guided tour');
  const sinusBtn = stepBtn(2, 'Sinus beat');
  const arrBtn = stepBtn(3, 'Arrhythmias');
  const layersBtn = topBtn('Layers and views');
  const brand = el(
    'span',
    'brand',
    `<span class="brand-name">Wavefront</span><svg class="brand-mark" viewBox="0 0 24 18" aria-hidden="true"><path d="M5 2.5Q1.5 9 5 15.5"/><path d="M11 1Q6 9 11 17"/><path d="M17.5 0Q11.5 9 17.5 18"/></svg>`,
  );
  // Space is the play key, so a clicked top-bar button must not keep the focus.
  topbar.addEventListener('click', (e) => (e.target as HTMLElement).closest('button')?.blur());
  topbar.append(brand, tourBtn, sinusBtn, arrBtn, el('span', 'spacer'), layersBtn);

  // ---------------------------------------------------------- stage
  const stage = el('main', 'stage');
  stage.appendChild(topbar);
  const viewport = el('div', 'viewport');
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('class', 'overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const hoverLabel = el('div', 'hoverlabel');
  const lower = el('div', 'lower');
  const playBeat = el('button', 'primary', 'Start the guided tour');
  playBeat.disabled = true;
  const hint = el('div', 'hint', 'Drag to rotate. Scroll to zoom. Shift-drag or arrow keys up and down to move the view. Select a structure for its name.');
  lower.append(playBeat, hint);
  const loading = el('div', 'loading', 'Loading the heart');
  viewport.append(overlay, hoverLabel, lower, loading);
  stage.appendChild(viewport);

  // ---------------------------------------------------------- drawer
  const drawer = el('aside', 'drawer');
  drawer.setAttribute('aria-label', 'Layers, views and structure details');

  const secMech = el('section', 'sec');
  secMech.id = 'sec-mech';
  secMech.appendChild(el('h2', undefined, 'Arrhythmias'));

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
  for (const [id, name] of [['sec-mech', 'Arrhythmias'], ['sec-structure', 'Structure'], ['sec-cutaway', 'Cutaway'], ['sec-layers', 'Layers'], ['sec-view', 'View']]) {
    const b = el('button', id === 'sec-mech' ? 'nav-mech' : undefined, name);
    b.addEventListener('click', () => goTo(id));
    nav.appendChild(b);
  }
  drawer.append(nav, secMech, secStructure, secCut, secLayers, secView, secCredit);

  // ---------------------------------------------------------- scene and bar
  const scene = new HeartScene(viewport);
  (window as any).epHeart = scene;
  viewport.insertBefore(scene.renderer.domElement, overlay);
  const bar = new PlayBar(scene);
  stage.appendChild(bar.root);
  app.append(stage, drawer);

  // ---------------------------------------------------------- behaviour
  const setDrawer = (open: boolean) => {
    app.classList.toggle('drawer-open', open);
    layersBtn.setAttribute('aria-pressed', String(open));
  };
  layersBtn.addEventListener('click', () => setDrawer(!app.classList.contains('drawer-open')));

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

  secLayers.appendChild(
    el('p', 'cap', 'Blue-grey marks vessels carrying blood towards the lungs and the venae cavae; coral marks the aorta and pulmonary veins. This is a convention, not a measurement.'),
  );

  // The activation map is shown only on the last step of the guided tour.
  const mapRange: [number, number] = [0, 260];
  const palette: PaletteId = 'safe';
  const setStyle = (s: 'live' | 'map') => {
    scene.setStyle(s);
    bar.setStyleState(s, mapRange, palette);
  };

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

  // ---------------------------------------------------------- scenarios
  let loader: ScenarioLoader | null = null;
  let current: { id: string; view: 'this' | 'normal' } | null = null;
  let mode: 'explore' | 'mechanisms' = 'explore';

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

  // mechanism picker: groups collapsed by default, one scenario selected at a time
  const infoBox = el('div', 'mech-info');
  const itemBtns = new Map<string, HTMLButtonElement>();
  const pickerLists: HTMLElement[] = [];
  for (const grp of GROUPS) {
    const items = SCENARIOS.filter((x) => x.group === grp.id);
    if (!items.length) continue;
    const wrap = el('div', 'mech-group');
    const head = el('button', 'mech-head', `<span>${grp.name}</span><span class="mech-count">${items.length}</span>`);
    head.setAttribute('aria-expanded', 'false');
    const list = el('ul', 'list');
    list.hidden = true;
    pickerLists.push(list);
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
    });
    for (const it of items) {
      const li = el('li');
      const b = el('button', 'vbtn', `<span>${it.title}</span>`);
      b.setAttribute('aria-pressed', 'false');
      b.disabled = true;
      b.addEventListener('click', () => openScenario(it.id));
      li.appendChild(b);
      list.appendChild(li);
      itemBtns.set(it.id, b);
    }
    wrap.append(head, list);
    secMech.appendChild(wrap);
  }
  secMech.appendChild(infoBox);
  const showInfo = (id: string | null) => {
    infoBox.innerHTML = '';
    itemBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
    const sc = SCENARIOS.find((x) => x.id === id);
    if (!sc) {
      infoBox.appendChild(el('p', 'struct-empty', 'Choose a rhythm to see which part of the heart is involved and what the impulse does.'));
      return;
    }
    infoBox.appendChild(el('h3', 'struct-name', sc.title));
    infoBox.appendChild(el('p', 'mech-summary', sc.summary));
    const more = el('button', 'pb-text mech-more', 'Show details');
    more.setAttribute('aria-expanded', 'false');
    const details = el('div', 'mech-details');
    details.hidden = true;
    details.append(el('ul', 'mech-points', sc.teaching_points.map((t) => `<li>${t}</li>`).join('')));
    more.addEventListener('click', () => {
      const open = details.hidden;
      details.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Hide details' : 'Show details';
    });
    infoBox.append(more, details);
  };
  showInfo(null);

  // The intended starting state of a scenario: its cutaway and camera. The first Play press after a
  // scenario opens returns here, so a rotated or scrubbed view always starts the animation properly.
  let startArmed = false;
  const applyStartView = (sc: (typeof SCENARIOS)[number], mine: boolean) => {
    if (mine && sc.cut) {
      scene.setCut(sc.cut.mode, sc.cut.offset, !sc.camera);
      cutBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === sc.cut!.mode)));
      cutSlider.disabled = false;
      cutSlider.value = String(sc.cut.offset);
      cutVal.textContent = `${Math.round(sc.cut.offset * 100)} mm`;
    } else if (scene.cut.mode !== 'off') {
      setCut('off', false);
    }
    if (mine && sc.camera) scene.setCamera(new Vector3(...sc.camera.dir), sc.camera.distance, sc.camera.focus ? scene.pathPoint(sc.camera.focus) : null);
  };
  scene.onBeforePlay = () => {
    if (!startArmed || !current) return;
    startArmed = false;
    const sc = SCENARIOS.find((x) => x.id === current!.id)!;
    scene.setTime(0);
    applyStartView(sc, current.view === 'this');
  };

  /** Show a scenario (or, with view 'normal', the sinus beat beside it) in the heart, bar and ECG. */
  let openToken = 0;
  const openScenario = async (id: string, view: 'this' | 'normal' = 'this', autoplay = false) => {
    if (!loader) return;
    endTour();
    const token = ++openToken;
    const data: Loaded = await loader.get(id);
    const shown: Loaded = view === 'normal' ? await loader.get('sinus_rhythm') : data;
    if (token !== openToken) return; // a newer choice was made while this one was solving
    const sc = data.sc;
    const fresh = !current || current.id !== id;
    current = { id, view };
    showInfo(id);
    scene.setActivation(shown.result, shown.constants);
    scene.playback.duration = shown.sc.period_ms;
    bar.setEvents(shown.events, shown.sc.period_ms);
    // time to hold on each step so its caption can be read: about 1.5 s plus 90 ms a word, 3 to 6.5 s
    scene.setGuide(
      shown.events.map((e) => {
        const words = `${e.caption} ${e.ecg ?? ''}`.trim().split(/\s+/).length;
        return { t: e.t, dwell: Math.min(6500, Math.max(3000, 1500 + words * 90)) };
      }),
    );
    if (shown.ecg) bar.setEcg(shown.ecg);
    bar.setScenario(sc.title, id !== 'sinus_rhythm', view);
    const mine = view === 'this';
    scene.setSubstrates(mine ? sc.show ?? [] : []);
    scene.setHighlight(mine ? sc.highlight ?? [] : []);
    scene.select(mine && sc.select ? sc.select : null, true);
    setConduction(true);
    if (mine && sc.epi_opacity !== undefined) setOpacity(sc.epi_opacity);
    if (fresh) {
      applyStartView(sc, mine);
      scene.setGuided(id !== 'sinus_rhythm'); // the normal beat plays straight through; the rhythms pause at each step
      bar.syncGuided();
    }
    lower.hidden = true;
    bar.show('beat');
    scene.setFocusLabels(mine ? sc.labels ?? [] : []);
    scene.setTime(0);
    startArmed = !autoplay; // a paused scenario starts from its intended state when Play is pressed
    if (autoplay) scene.play();
    else scene.pause();
    app.classList.add('bar-open');
    syncControls();
    bar.setNext(mode === 'explore' && id === 'sinus_rhythm' ? 'Next: arrhythmias' : null);
    syncNav();
  };
  const openBeat = () => void openScenario('sinus_rhythm', 'this', true);
  bar.onCompare = (v) => current && void openScenario(current.id, v);

  const closeBar = () => {
    scene.pause();
    scene.select(null, true);
    scene.setSubstrates([]);
    scene.setHighlight([]);
    scene.setFocusLabels([]);
    bar.hide();
    lower.hidden = false;
    app.classList.remove('bar-open');
    tourBtn.setAttribute('aria-pressed', 'false');
    tourStep = -1;
    current = null;
    syncNav();
  };
  bar.onClose = () => {
    closeBar();
    if (scene.style === 'map') setStyle('live');
  };

  const syncNav = () => {
    const beatOpen = bar.visible && bar.currentMode === 'beat';
    tourBtn.setAttribute('aria-pressed', String(tourStep >= 0));
    sinusBtn.setAttribute('aria-pressed', String(mode === 'explore' && beatOpen && current?.id === 'sinus_rhythm'));
    arrBtn.setAttribute('aria-pressed', String(mode === 'mechanisms'));
  };
  const setMode = (m: 'explore' | 'mechanisms') => {
    mode = m;
    app.dataset.mode = m;
    if (bar.visible) bar.onClose();
    playBeat.textContent = m === 'explore' ? 'Start the guided tour' : 'Choose a rhythm';
    if (m === 'mechanisms') {
      setDrawer(true);
      requestAnimationFrame(() => goTo('sec-mech'));
    }
    syncNav();
  };
  sinusBtn.addEventListener('click', () => {
    if (mode !== 'explore') setMode('explore');
    openBeat();
  });
  arrBtn.addEventListener('click', () => setMode('mechanisms'));
  bar.onNext = () => setMode('mechanisms');
  app.dataset.mode = 'explore';
  playBeat.addEventListener('click', () => {
    if (mode === 'explore') void startTour();
    else {
      setDrawer(true);
      goTo('sec-mech');
    }
  });

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
    setLabels(false); // the tour names only what each step is about
    scene.setFocusLabels(s.labelOnly ?? []);
    if (s.drawer) {
      setDrawer(true);
      requestAnimationFrame(() => goTo('sec-cutaway'));
    }
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
  const startTour = async () => {
    if (!loader) return;
    if (mode !== 'explore') setMode('explore');
    const sinus = await loader.get('sinus_rhythm'); // the map step always shows the normal beat
    if (scene.style === 'map') setStyle('live');
    scene.setActivation(sinus.result, sinus.constants);
    scene.setMapRange(mapRange[0], mapRange[1]);
    lower.hidden = true;
    tourBtn.setAttribute('aria-pressed', 'true');
    bar.show('tour');
    bar.reserveTour(TOUR.map((t) => t.text));
    app.classList.add('bar-open');
    applyTourStep(0);
    syncNav();
  };
  const endTour = () => {
    if (tourStep < 0) return;
    tourStep = -1;
    scene.setFocusLabels([]);
    bar.hide();
    tourBtn.setAttribute('aria-pressed', 'false');
    app.classList.remove('bar-open');
    lower.hidden = false;
    syncNav();
  };
  bar.onTourStep = (d) => {
    const n = tourStep + d;
    if (n >= TOUR.length) return openBeat(); // the tour leads straight into the sinus beat
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
    else if (e.key === ' ' && loader && t?.tagName !== 'BUTTON') {
      e.preventDefault();
      if (!bar.visible && mode === 'explore') openBeat();
      else if (bar.currentMode === 'beat') scene.togglePlay();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      scene.panBy(0, e.key === 'ArrowUp' ? 0.08 : -0.08); // Up looks higher up the heart
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      if (bar.currentMode === 'beat') bar.stepEvent(d);
      else if (bar.currentMode === 'tour') bar.onTourStep(d);
    }
  });

  /** Called once the activation graph is loaded: the picker and the primary action become usable. */
  const attachScenarios = (l: ScenarioLoader) => {
    loader = l;
    playBeat.disabled = false;
    itemBtns.forEach((b) => (b.disabled = false));
  };

  return { scene, app, loading, chamberInputs, attachScenarios, openScenario, get current() { return current; } };
}
