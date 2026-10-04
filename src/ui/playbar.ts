import { PALETTES, PaletteId } from '../engine/material';
import { HeartScene } from '../scene/HeartScene';

export interface BeatEvent {
  id: string;
  label: string;
  t: number;
  caption: string;
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
  private caption = el('p', 'pb-caption');
  private beat = el('div', 'pb-beat');
  private tour = el('div', 'pb-tour');
  private playBtn = el('button', 'pb-btn', ICON.play);
  private slider = el('input');
  private ticks = el('div', 'pb-ticks');
  private time = el('span', 'pb-time', '0 ms');
  private speedBtns: HTMLButtonElement[] = [];
  private loopBtn = el('button', 'pb-btn', ICON.loop);
  private styleBtns = new Map<string, HTMLButtonElement>();
  private legend = el('div', 'pb-legend');
  private legendCanvas = el('canvas');
  private legendTicks = el('div', 'pb-legend-ticks');
  private events: BeatEvent[] = [];
  private mode: 'beat' | 'tour' | null = null;
  onClose: () => void = () => {};
  onTourStep: (delta: number) => void = () => {};
  onStyle: (s: 'live' | 'map') => void = () => {};
  private tourTitle = el('span', 'pb-tour-title');
  private tourCount = el('span', 'pb-tour-count');
  private tourBack = el('button', 'pb-text', 'Back');
  private tourNext = el('button', 'pb-text', 'Next');

  constructor(private scene: HeartScene) {
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Playback');

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
    const style = el('div', 'pb-style');
    style.setAttribute('role', 'group');
    style.setAttribute('aria-label', 'Display style');
    for (const [id, name] of [['live', 'Wave'], ['map', 'Map']] as const) {
      const b = el('button', 'pb-text', name);
      b.setAttribute('aria-pressed', String(id === 'live'));
      b.addEventListener('click', () => this.onStyle(id));
      style.appendChild(b);
      this.styleBtns.set(id, b);
    }
    const close = el('button', 'pb-btn', ICON.close);
    close.setAttribute('aria-label', 'Close the beat player');

    const strip = el('div', 'pb-legend-strip');
    strip.append(this.legendCanvas, this.legendTicks);
    this.legend.append(strip, el('em', 'pb-legend-unit', 'ms after the sinus node fires'));
    this.legendCanvas.width = 160;
    this.legendCanvas.height = 6;
    const controls = el('div', 'pb-controls');
    controls.append(prev, this.playBtn, next, scrub, this.time, speed, this.loopBtn, style, close);
    this.beat.append(controls, this.legend);

    // ---- tour face
    const tourRow = el('div', 'pb-controls');
    const exit = el('button', 'pb-text', 'End tour');
    tourRow.append(this.tourBack, this.tourCount, this.tourNext, el('span', 'pb-spacer'), exit);
    this.tour.append(this.tourTitle, tourRow);
    exit.addEventListener('click', () => this.onClose());
    this.tourBack.addEventListener('click', () => this.onTourStep(-1));
    this.tourNext.addEventListener('click', () => this.onTourStep(1));

    this.root.append(this.caption, this.beat, this.tour);

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

  setEvents(events: BeatEvent[], duration: number) {
    this.events = [...events].sort((a, b) => a.t - b.t);
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

  setSpeed(s: number) {
    this.scene.playback.speed = s;
    this.speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === s)));
  }

  setStyleState(style: 'live' | 'map', range: [number, number], palette: PaletteId) {
    this.styleBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === style)));
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
    this.caption.textContent = text;
    this.tourBack.disabled = step === 0;
    this.tourNext.textContent = step === total - 1 ? 'Finish' : 'Next';
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
    this.caption.textContent = e ? e.caption : 'Press play to see one normal beat.';
    this.ticks.querySelectorAll('.pb-tick').forEach((n, i) => n.classList.toggle('on', this.events[i] === e));
  }
}
