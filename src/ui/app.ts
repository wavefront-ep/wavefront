import { BY_MESH, CHAMBERS, Chamber } from '../data/structures';
import { CutMode, HeartScene, PlacedLabel } from '../scene/HeartScene';
import { VIEWS } from '../scene/views';

const svg = (d: string) =>
  `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${d}"/></svg>`;

const ICONS = {
  // Outline of a heart-like form with a vertical axis: explore the anatomy.
  explore: svg('M10 17C5 13.5 3 10.5 3 7.8 3 5.6 4.7 4 6.6 4c1.4 0 2.6.8 3.4 2 .8-1.2 2-2 3.4-2C15.3 4 17 5.6 17 7.8c0 2.7-2 5.7-7 9.2Z'),
  // A flat trace with one excursion: arrhythmia mechanisms.
  mechanisms: svg('M2 11h4l1.5-5 3 9 1.7-4H18'),
  // Three stacked rules: layers and views.
  layers: svg('M3 5h14M3 10h14M3 15h14'),
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
  const layersBtn = railBtn(ICONS.layers, 'Layers and views');
  layersBtn.setAttribute('aria-pressed', 'false');
  rail.appendChild(layersBtn);

  // ---------------------------------------------------------- stage
  const stage = el('main', 'stage');
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('class', 'overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const hoverLabel = el('div', 'hoverlabel');
  const hint = el('div', 'hint', 'Drag to rotate. Scroll to zoom. Select a structure for its name.');
  const loading = el('div', 'loading', 'Loading the heart');
  stage.append(overlay, hoverLabel, hint, loading);

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
    el('p', 'cap', 'Heart geometry: Rodero et al., PLoS Computational Biology 2021, average shape of a healthy-adult statistical model (CC BY 4.0). Surface extracted, smoothed and decimated for this viewer.'),
  );
  drawer.append(secStructure, secView, secLayers, secCut, secCredit);
  app.append(rail, stage, drawer);

  // ---------------------------------------------------------- scene
  const scene = new HeartScene(stage);
  (window as any).epHeart = scene;
  stage.insertBefore(scene.renderer.domElement, overlay);

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
  opacity.addEventListener('input', () => {
    L.epiOpacity = Number(opacity.value);
    opVal.textContent = `${Math.round(L.epiOpacity * 100)}%`;
    scene.applyLayers();
  });
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
  const labels = check('Labels', L.labels, (v) => setLabels(v), 'row', 'L');
  secLayers.appendChild(labels.label);
  secLayers.appendChild(
    el('p', 'cap', 'Blue-grey marks vessels carrying blood towards the lungs and the venae cavae; coral marks the aorta and pulmonary veins. This is a convention, not a measurement.'),
  );

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
  const setCut = (mode: CutMode) => {
    scene.setCut(mode, 0, true);
    cutSlider.value = '0';
    cutVal.textContent = '0 mm';
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
    el('p', 'cap', 'The four-chamber plane passes through the apex and the centres of the mitral and tricuspid valves. Valves are drawn as closed planes.'),
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
  stage.addEventListener('pointerdown', dismissHint, { once: true });
  stage.addEventListener('wheel', dismissHint, { once: true, passive: true });
  window.addEventListener('keydown', dismissHint, { once: true });

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
    else if (k === 'escape') {
      scene.select(null);
    }
  });

  return { scene, app, loading, chamberInputs };
}
