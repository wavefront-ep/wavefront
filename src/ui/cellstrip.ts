import { CELL_BY_ID, CellTrace, CellType, V_MAX, V_MIN, phaseAt, phaseText } from '../cell/actionPotential';
import type { CellView } from './loader';

const ns = 'http://www.w3.org/2000/svg';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export const CELL_COLOURS: Record<CellType, string> = {
  pacemaker: '#b8921f',
  atrial: '#c4727a',
  av_node: '#6f8da8',
  purkinje: '#4f7a70',
  ventricular: '#2a2624',
};

const Y0 = 6;
const YH = 78;
const y = (mv: number) => Y0 + ((V_MAX - mv) / (V_MAX - V_MIN)) * YH;

/** The cellular view: the action potential of the cells at one site, on the same time axis as the scrubber
 *  and the ECG, with the phase under the playhead named. Schematic. */
export class CellStrip {
  readonly root = el('div', 'pb-cellrow');
  private label = el('div', 'pb-cell-label');
  private picker = el('div', 'pb-cell-picker');
  private box = el('div', 'pb-cell');
  private info = el('div', 'pb-cell-info');
  private phase = el('p', 'pb-cell-phase');
  private note = el('p', 'pb-cell-note');
  private cursor = el('div', 'pb-cell-cursor');
  private dot = el('div', 'pb-cell-dot');
  private view: CellView | null = null;
  private duration = 1000;
  private selected: CellType | 'all' = 'ventricular';
  private btns = new Map<string, HTMLButtonElement>();
  private shown: CellTrace | null = null;

  constructor() {
    this.root.hidden = true;
    this.label.innerHTML = 'Cell view<br><em>schematic</em>';
    this.picker.setAttribute('role', 'group');
    this.picker.setAttribute('aria-label', 'Cell type');
    this.label.appendChild(this.picker);
    this.info.append(this.phase, this.note);
    this.root.append(this.label, this.box, this.info);
  }

  get visible() {
    return !this.root.hidden;
  }

  show(on: boolean) {
    this.root.hidden = !on || !this.view;
  }

  /** Load a scenario's cell view; null hides the strip. */
  setView(view: CellView | null, duration: number) {
    this.view = view;
    this.duration = duration;
    this.picker.innerHTML = '';
    this.btns.clear();
    if (!view) {
      this.root.hidden = true;
      return;
    }
    if (!view.illustrative) {
      const types: (CellType | 'all')[] = view.types.length > 2 ? [...view.types, 'all'] : [...view.types];
      if (types.length > 1) {
        for (const id of types) {
          const b = el('button', 'pb-text', id === 'all' ? 'All' : CELL_BY_ID[id].label);
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => this.select(id));
          this.picker.appendChild(b);
          this.btns.set(id, b);
        }
      }
    }
    this.note.textContent = view.note;
    this.select(view.default);
  }

  private select(id: CellType | 'all') {
    this.selected = id;
    this.btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
    this.draw();
  }

  private draw() {
    const v = this.view;
    this.box.innerHTML = '';
    this.shown = null;
    if (!v) return;
    const W = v.illustrative ? 800 : this.duration;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} 100`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('line', { x1: 0, x2: W, y1: y(0), y2: y(0), class: 'pb-cell-zero' }));
    let traces: { tr: CellTrace; colour: string; label?: string }[];
    if (v.illustrative) {
      traces = v.illustrative.map((i, k) => ({ tr: i.trace, colour: k === 0 ? 'var(--muted)' : 'var(--ink)', label: i.label }));
    } else if (this.selected === 'all') {
      traces = v.types.map((t) => ({ tr: v.traces[t]!, colour: CELL_COLOURS[t], label: CELL_BY_ID[t].label }));
    } else {
      traces = [{ tr: v.traces[this.selected]!, colour: 'var(--ink)' }];
    }
    // shaded excitable gap, behind the trace
    if (v.gap && traces.length === 1) {
      const g = traces[0].tr.gaps[0];
      if (g) svg.appendChild(svgEl('rect', { x: g[0], width: g[1] - g[0], y: Y0, height: YH, class: 'pb-cell-gap' }));
    }
    for (const { tr, colour } of traces) {
      let d = '';
      for (let t = 0; t < tr.mv.length; t += 1) d += `${t === 0 ? 'M' : 'L'}${t},${y(tr.mv[t]).toFixed(1)}`;
      svg.appendChild(svgEl('path', { d, class: 'pb-cell-trace', style: `stroke:${colour}` }));
    }
    this.box.appendChild(svg);
    const tag = (text: string, left: number, top: number, cls = '') => {
      const s = el('span', `pb-cell-text ${cls}`, text);
      s.style.left = `${(left / W) * 100}%`;
      s.style.top = `${top}px`;
      this.box.appendChild(s);
      return s;
    };
    const axis = el('span', 'pb-cell-text axis', '0 mV');
    axis.style.top = `${y(0) - 13}px`;
    this.box.appendChild(axis);
    if (v.illustrative) {
      const legend = el('div', 'pb-cell-legend');
      v.illustrative.forEach((it, i) => {
        const k = el('span', undefined, it.label);
        k.style.color = i === 0 ? 'var(--muted)' : 'var(--ink)';
        legend.appendChild(k);
      });
      this.box.appendChild(legend);
      this.phase.textContent = '';
      this.cursor.hidden = true;
      this.dot.hidden = true;
      this.shown = null;
      this.box.append(this.cursor);
      return;
    }
    this.btns.forEach((b, k) => {
      b.style.color = this.selected === 'all' && k !== 'all' ? CELL_COLOURS[k as CellType] : '';
    });
    if (traces.length > 1) {
      this.shown = null;
    } else {
      this.shown = traces[0].tr;
      // phase numbers on the first action potential
      // only when the first action potential is wide enough on this time axis to carry the numbers
      const firstRamp = this.shown.segs.find((q) => q.phase === 4 && q.ramp);
      const first = this.shown.apd / W < 0.15 ? [] : this.shown.segs.filter((q) => q.ap === 0 || q === firstRamp);
      for (const s of first) {
        const mid = (s.t0 + s.t1) / 2;
        const idx = Math.min(this.shown.mv.length - 1, Math.max(0, Math.round(mid)));
        const top = s.phase === 4 ? y(this.shown.mv[idx]) - 17 : y(this.shown.mv[idx]) - (s.phase === 3 ? -4 : 17);
        if (s.t1 - s.t0 >= 6) tag(String(s.phase), mid + (s.phase === 3 ? 6 : 0), top, 'phase');
      }
      if (v.gap && this.shown.gaps[0]) {
        const g = this.shown.gaps[0];
        tag('Excitable gap', (g[0] + g[1]) / 2, -13, 'gaplabel');
      }
    }
    this.box.append(this.cursor, this.dot);
    this.cursor.hidden = false;
    this.update(0);
  }

  /** Move the playhead cursor, the dot on the trace and the phase text. */
  update(t: number) {
    const v = this.view;
    if (!v || v.illustrative) return;
    this.cursor.style.left = `${(t / this.duration) * 100}%`;
    const tr = this.shown;
    if (!tr) {
      this.dot.hidden = true;
      this.phase.textContent = this.selected === 'all' ? 'Each cell type fires when the impulse reaches it. Choose one to see its phases.' : '';
      return;
    }
    const i = Math.min(tr.mv.length - 1, Math.max(0, Math.round(t)));
    this.dot.hidden = false;
    this.dot.style.left = `${(t / this.duration) * 100}%`;
    this.dot.style.top = `${y(tr.mv[i])}px`;
    const p = phaseAt(tr, t);
    let ead = false;
    if (p.ap >= 0 && tr.ead.includes(p.ap)) {
      const c = tr.acts[p.ap] + 0.78 * tr.apd;
      ead = Math.abs(t - c) < 0.1 * tr.apd;
    }
    const names = ['0', '1', '2', '3', '4'];
    this.phase.textContent = phaseText(tr.type, p.phase, p.ramp, ead) || `Phase ${names[p.phase]}`;
  }
}

