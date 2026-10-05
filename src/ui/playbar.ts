import { PALETTES, PaletteId } from '../engine/material';
import type { Ecg } from '../ecg/morphology';
import { HeartScene } from '../scene/HeartScene';

export interface BeatEvent {
  id: string;
  label: string;
  t: number;
  caption: string;
  ecg?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const ICON = {
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5v11l9-5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.5v11M13.5 4.5v11"/></svg>',
  prev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4.5 7 10l6 5.5M5 4.5v11"/></svg>',
  next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5 13 10l-6 5.5M15 4.5v11"/></svg>',
  loop: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 9V7.5A2.5 2.5 0 0 1 6.5 5H15M13 3l2 2-2 2M16 11v1.5a2.5 2.5 0 0 1-2.5 2.5H5M7 17l-2-2 2-2"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>',
};

const SPEEDS = [0.02, 0.05, 0.1, 0.25, 0.5, 1];

/** Bottom bar. Two faces: the beat player (caption, transport, scrubber with event ticks, speed,
 *  loop) and the guided-tour stepper. Hidden until one of them is opened. */
export class PlayBar {
  readonly root = el('div', 'playbar');
  private head = el('div', 'pb-head');
  private title = el('span', 'pb-title');
  private compare = el('div', 'pb-compare');
  private compareBtns = new Map<string, HTMLButtonElement>();
  onCompare: (view: 'normal' | 'this') => void = () => {};
  private guidedBox = el('input');
  private guidedLabel = el('label', 'pb-guided');
  private caption = el('p', 'pb-caption');
  private captionLabel = el('strong', 'pb-caption-label');
  private captionText = el('span');
  private beat = el('div', 'pb-beat');
  private tour = el('div', 'pb-tour');
  private playBtn = el('button', 'pb-btn', ICON.play);
  private slider = el('input');
  private ticks = el('div', 'pb-ticks');
  private time = el('span', 'pb-time', '0 ms');
  private speedBtns: HTMLButtonElement[] = [];
  private loopBtn = el('button', 'pb-btn', ICON.loop);
  private legend = el('div', 'pb-legend');
  private legendCanvas = el('canvas');
  private legendTicks = el('div', 'pb-legend-ticks');
  private events: BeatEvent[] = [];
  private ecgBox = el('div', 'pb-ecg');
  private ecgCursor = el('div', 'pb-ecg-cursor');
  private ecgSegs: { el: SVGRectElement; range: [number, number] }[] = [];
  private ecgMarks: HTMLButtonElement[] = [];
  private ecgRow = el('div', 'pb-ecgrow');
  private ecgVals = el('div', 'pb-ecg-vals');
  private ecgNote = el('p', 'pb-ecgnote');
  private ecgNoteText = el('span', 'pb-live');
  private captionLive = el('span', 'pb-live');
  private duration = 1000;
  private mode: 'beat' | 'tour' | null = null;
  onClose: () => void = () => {};
  onNext: () => void = () => {};
  private nextBtn = el('button', 'pb-text pb-next', 'Next');
  onTourStep: (delta: number) => void = () => {};
  private tourTitle = el('span', 'pb-tour-title');
  private tourCount = el('span', 'pb-tour-count');
  private tourAtEnd = false;
  private tourBack = el('button', 'pb-text', 'Back');
  private tourNext = el('button', 'pb-text', 'Next');

  constructor(private scene: HeartScene) {
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Playback');
    this.captionLive.append(this.captionLabel, this.captionText);
    this.caption.setAttribute('aria-live', 'polite'); // a screen reader hears each step as the caption changes
    this.caption.append(this.captionLive);
    this.ecgNote.append(this.ecgNoteText);
    this.compare.setAttribute('role', 'group');
    this.compare.setAttribute('aria-label', 'Normal rhythm or this rhythm');
    for (const [id, name] of [['normal', 'Normal'], ['this', 'This rhythm']] as const) {
      const b = el('button', 'pb-text', name);
      b.setAttribute('aria-pressed', String(id === 'this'));
      b.addEventListener('click', () => this.onCompare(id));
      this.compare.appendChild(b);
      this.compareBtns.set(id, b);
    }
    this.compare.hidden = true;
    // Guided playback switch: lives above the transport buttons, in plain words.
    this.guidedBox.type = 'checkbox';
    this.guidedBox.checked = scene.playback.guided;
    this.guidedBox.addEventListener('change', () => scene.setGuided(this.guidedBox.checked));
    this.guidedLabel.title = 'On: stops on each step long enough to read it and skips quickly across quiet stretches. Off: plays straight through.';
    this.guidedLabel.append(this.guidedBox, el('span', undefined, 'Pause at each step'));
    const opts = this.compare;
    this.nextBtn.hidden = true;
    this.nextBtn.addEventListener('click', () => this.onNext());
    this.head.append(this.title, opts, el('span', 'pb-spacer'), this.nextBtn);

    // ---- beat face
    this.playBtn.setAttribute('aria-label', 'Play or pause (space)');
    const prev = el('button', 'pb-btn', ICON.prev);
    prev.setAttribute('aria-label', 'Previous event (left arrow)');
    const next = el('button', 'pb-btn', ICON.next);
    next.setAttribute('aria-label', 'Next event (right arrow)');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.step = '1';
    this.slider.value = '0';
    this.slider.setAttribute('aria-label', 'Heart time');
    const scrub = el('div', 'pb-scrub');
    scrub.append(this.ticks, this.slider);

    const speed = el('div', 'pb-speed');
    speed.setAttribute('role', 'group');
    speed.setAttribute('aria-label', 'Playback speed');
    for (const s of SPEEDS) {
      const b = el('button', 'pb-text', `${s}×`);
      b.setAttribute('aria-pressed', String(s === scene.playback.speed));
      b.addEventListener('click', () => this.setSpeed(s));
      speed.appendChild(b);
      this.speedBtns.push(b);
    }
    this.loopBtn.setAttribute('aria-label', 'Loop');
    this.loopBtn.setAttribute('aria-pressed', String(scene.playback.loop));
    const close = el('button', 'pb-btn', ICON.close);
    close.setAttribute('aria-label', 'Close the beat player');

    const strip = el('div', 'pb-legend-strip');
    strip.append(this.legendCanvas, this.legendTicks);
    this.legend.append(strip, el('em', 'pb-legend-unit', 'ms on the timeline'));
    this.legendCanvas.width = 160;
    this.legendCanvas.height = 6;
    // Left: transport. Middle: scrubber (same time axis as the ECG above it). Right: readout and options.
    const controls = el('div', 'pb-controls');
    const transport = el('div', 'pb-transport');
    transport.append(this.guidedLabel, el('div', 'pb-transport-btns'));
    transport.lastElementChild!.append(prev, this.playBtn, next);
    const right = el('div', 'pb-right');
    right.append(this.time, speed, this.loopBtn, close);
    controls.append(transport, scrub, right);

    const ecgLabel = el('div', 'pb-ecg-label', 'Lead II<br><em>schematic</em>');
    this.ecgRow.append(ecgLabel, this.ecgBox, this.ecgVals);
    this.ecgRow.hidden = true;
    this.ecgNote.hidden = true;
    this.beat.append(this.ecgRow, controls);

    // ---- tour face
    const tourRow = el('div', 'pb-controls');
    const exit = el('button', 'pb-text', 'End tour');
    tourRow.append(this.tourBack, this.tourCount, this.tourNext, el('span', 'pb-spacer'), exit);
    this.tour.append(this.tourTitle, tourRow, this.legend);
    // On the last step, ending the tour carries on to the sinus beat.
    exit.addEventListener('click', () => (this.tourAtEnd ? this.onTourStep(1) : this.onClose()));
    this.tourBack.addEventListener('click', () => this.onTourStep(-1));
    this.tourNext.addEventListener('click', () => this.onTourStep(1));

    this.root.append(this.head, this.caption, this.ecgNote, this.beat, this.tour);

    // ---- behaviour
    this.playBtn.addEventListener('click', () => scene.togglePlay());
    prev.addEventListener('click', () => this.stepEvent(-1));
    next.addEventListener('click', () => this.stepEvent(1));
    this.slider.addEventListener('input', () => {
      scene.pause();
      scene.setTime(Number(this.slider.value));
    });
    this.loopBtn.addEventListener('click', () => {
      scene.playback.loop = !scene.playback.loop;
      this.loopBtn.setAttribute('aria-pressed', String(scene.playback.loop));
    });
    close.addEventListener('click', () => this.onClose());

    scene.onTime = (t) => this.update(t);
    scene.onPlayState = (p) => {
      this.playBtn.innerHTML = p ? ICON.pause : ICON.play;
    };
  }

  /** Title of the scenario being played; `canCompare` shows the Normal / This rhythm switch. */
  setScenario(title: string, canCompare: boolean, view: 'normal' | 'this') {
    this.title.textContent = title;
    this.compare.hidden = !canCompare;
    this.compareBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === view)));
  }

  /** Invisible copies of every text the box can show, stacked in one grid cell, so the box keeps the height of the longest and the view of the heart does not move as the text changes. */
  private reserve(captions: string[], notes: string[]) {
    for (const [box, texts] of [[this.caption, captions], [this.ecgNote, notes]] as const) {
      box.querySelectorAll('.pb-ghost').forEach((n) => n.remove());
      for (const t of texts) {
        const g = el('span', 'pb-ghost');
        g.setAttribute('aria-hidden', 'true');
        g.textContent = t;
        box.appendChild(g);
      }
    }
  }

  /** Reserve room for the tour's texts. */
  reserveTour(texts: string[]) {
    this.reserve(texts, []);
  }

  setEvents(events: BeatEvent[], duration: number) {
    this.events = [...events].sort((a, b) => a.t - b.t);
    this.reserve(
      [...this.events.map((e) => `${e.label}. ${e.caption}`), 'Press play to start. The animation pauses at each step so you can read it.'],
      this.events.filter((e) => e.ecg).map((e) => `On the ECG: ${e.ecg}`),
    );
    this.duration = duration;
    this.slider.max = String(duration);
    this.ticks.innerHTML = '';
    for (const e of this.events) {
      const t = el('button', 'pb-tick');
      t.style.left = `${(e.t / duration) * 100}%`;
      t.title = `${e.label}, ${Math.round(e.t)} ms`;
      t.setAttribute('aria-label', `${e.label}, ${Math.round(e.t)} milliseconds`);
      t.addEventListener('click', () => {
        this.scene.pause();
        this.scene.setTime(e.t);
      });
      this.ticks.appendChild(t);
    }
  }

  show(mode: 'beat' | 'tour') {
    this.mode = mode;
    this.root.hidden = false;
    this.head.hidden = mode !== 'beat';
    this.beat.hidden = mode !== 'beat';
    this.tour.hidden = mode !== 'tour';
    this.root.dataset.mode = mode;
    this.update(this.scene.playback.t);
  }

  hide() {
    this.mode = null;
    this.root.hidden = true;
  }

  get visible() {
    return this.mode !== null;
  }

  get currentMode() {
    return this.mode;
  }

  /** The next stage of the route through the tool, offered from the sinus beat; null hides it. */
  setNext(label: string | null) {
    this.nextBtn.hidden = !label;
    if (label) this.nextBtn.textContent = label;
  }

  /** Show the state of the 'Pause at each step' switch after the scene's setting changed. */
  syncGuided() {
    this.guidedBox.checked = this.scene.playback.guided;
  }

  setSpeed(s: number) {
    this.scene.playback.speed = s;
    this.speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === s)));
  }

  setStyleState(style: 'live' | 'map', range: [number, number], palette: PaletteId) {
    this.legend.hidden = style !== 'map';
    if (style === 'map') this.drawLegend(range, palette);
  }

  private drawLegend(range: [number, number], palette: PaletteId) {
    const ctx = this.legendCanvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 160, 0);
    PALETTES[palette].stops.forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 160, 6);
    const [a, b] = range;
    this.legendTicks.innerHTML = [a, Math.round((a + b) / 2 / 10) * 10, b].map((v) => `<span>${v}</span>`).join('');
  }

  setTour(step: number, total: number, title: string, text: string) {
    this.tourTitle.textContent = title;
    this.tourCount.textContent = `${step + 1} of ${total}`;
    this.captionLabel.textContent = '';
    this.captionText.textContent = text;
    this.ecgNoteText.textContent = '';
    this.tourAtEnd = step === total - 1;
    this.tourBack.disabled = step === 0;
    this.tourNext.textContent = step === total - 1 ? 'Next: sinus beat' : 'Next';
  }

  private currentEvent(t: number): BeatEvent | null {
    let cur: BeatEvent | null = null;
    for (const e of this.events) if (e.t <= t + 0.5) cur = e;
    return cur;
  }

  stepEvent(dir: number) {
    const t = this.scene.playback.t;
    this.scene.pause();
    if (dir > 0) {
      const n = this.events.find((e) => e.t > t + 1);
      this.scene.setTime(n ? n.t : this.events[0].t);
    } else {
      const p = [...this.events].reverse().find((e) => e.t < t - 1);
      this.scene.setTime(p ? p.t : this.events[this.events.length - 1].t);
    }
  }

  private update(t: number) {
    if (this.mode !== 'beat') return;
    this.slider.value = String(Math.round(t));
    this.time.textContent = `${Math.round(t)} ms`;
    const e = this.currentEvent(t);
    this.captionLabel.textContent = e ? `${e.label}. ` : '';
    this.captionText.textContent = e ? e.caption : 'Press play to start. The animation pauses at each step so you can read it.';
    this.ecgNoteText.textContent = e?.ecg ? `On the ECG: ${e.ecg}` : '';
    this.ticks.querySelectorAll('.pb-tick').forEach((n, i) => n.classList.toggle('on', this.events[i] === e));
    this.ecgCursor.style.left = `${(t / this.duration) * 100}%`;
    for (const s of this.ecgSegs) s.el.classList.toggle('on', t >= s.range[0] && t <= s.range[1]);
    this.ecgMarks.forEach((m, i) => m.classList.toggle('on', this.events[i] === e));
  }

  /** Draw the strip: the trace, wave segments that light up as the playhead passes, and one numbered
   *  marker per sequence event, all on the same time axis as the scrubber. */
  setEcg(ecg: Ecg) {
    const W = this.duration;
    const base = 62;
    const y = (a: number) => base - a * 50;
    let d = '';
    for (let x = 0; x <= W; x += 2) d += `${x === 0 ? 'M' : 'L'}${x},${y(ecg.samples[x]).toFixed(1)}`;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} 100`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    this.ecgSegs = [];
    for (const sg of ecg.segments) {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(sg.range[0]));
      r.setAttribute('width', String(Math.max(2, sg.range[1] - sg.range[0])));
      r.setAttribute('y', '0');
      r.setAttribute('height', '100');
      r.setAttribute('class', 'pb-ecg-seg');
      svg.appendChild(r);
      this.ecgSegs.push({ el: r, range: sg.range });
    }
    const baseline = document.createElementNS(ns, 'line');
    baseline.setAttribute('x1', '0');
    baseline.setAttribute('x2', String(W));
    baseline.setAttribute('y1', String(base));
    baseline.setAttribute('y2', String(base));
    baseline.setAttribute('class', 'pb-ecg-base');
    svg.appendChild(baseline);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'pb-ecg-trace');
    svg.appendChild(path);

    this.ecgBox.innerHTML = '';
    this.ecgBox.appendChild(svg);
    // Name the first wave of each kind; naming every one of a long run would only clutter the strip.
    const named = new Set<string>();
    const names: Record<string, string> = { P: 'P', QRS: 'QRS', T: 'T', F: 'Flutter waves', AF: 'Fibrillatory waves', VF: 'Ventricular fibrillation' };
    const texts: HTMLElement[] = [];
    for (const sg of ecg.segments) {
      if (named.has(sg.kind)) continue;
      named.add(sg.kind);
      const s2 = el('span', 'pb-ecg-text', names[sg.kind]);
      s2.style.left = `${(((sg.range[0] + sg.range[1]) / 2 + (sg.kind === 'QRS' ? 18 : 0)) / W) * 100}%`;
      this.ecgBox.appendChild(s2);
      texts.push(s2);
    }
    // Wave names sit in a band under the trace, clear of the numbered markers along the top; a name
    // that would run into its neighbour drops to a second row, and none runs off the ends of the strip.
    requestAnimationFrame(() => {
      const boxW = this.ecgBox.clientWidth;
      if (!boxW) return;
      const rowEnd = [-Infinity, -Infinity];
      for (const t of texts.sort((a, b) => a.offsetLeft - b.offsetLeft)) {
        const w = t.offsetWidth;
        const left = Math.min(Math.max(t.offsetLeft - w / 2, 0), boxW - w);
        const row = rowEnd[0] + 6 <= left ? 0 : 1;
        rowEnd[row] = left + w;
        t.style.left = `${left}px`;
        t.style.transform = 'none';
        t.style.top = `${84 + row * 13}px`;
      }
    });
    // numbered event markers along the top edge, matching the ticks on the scrubber
    this.ecgMarks = this.events.map((e, i) => {
      const m = el('button', 'pb-ecg-mark', String(i + 1));
      m.style.left = `${(e.t / W) * 100}%`;
      m.style.top = `${(i % 2) * 15 + 2}px`;
      m.title = `${i + 1}. ${e.label}, ${Math.round(e.t)} ms`;
      m.setAttribute('aria-label', `Event ${i + 1}: ${e.label}, ${Math.round(e.t)} milliseconds`);
      m.addEventListener('click', () => {
        this.scene.pause();
        this.scene.setTime(e.t);
      });
      this.ecgBox.appendChild(m);
      return m;
    });
    this.ecgBox.appendChild(this.ecgCursor);
    this.ecgVals.innerHTML = '';
    const toggle = el('button', 'pb-text pb-ecg-toggle', 'Hide ECG');
    toggle.setAttribute('aria-pressed', 'true');
    toggle.addEventListener('click', () => {
      const on = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Hide ECG' : 'Show ECG';
      this.ecgBox.hidden = !on;
      this.ecgNote.hidden = !on;
    });
    this.ecgVals.appendChild(toggle);
    this.ecgRow.hidden = false;
    this.ecgNote.hidden = false;
    this.update(this.scene.playback.t);
  }
}
