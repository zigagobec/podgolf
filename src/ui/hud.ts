import { PLAYER_CSS, PLAYER_NAMES } from '../materials';
import { mat4, type Mat4, type Vec3 } from '../math';

export type Rect = [number, number, number, number];

interface Pane {
  root: HTMLDivElement;
  strokes: HTMLSpanElement;
  dist: HTMLDivElement;
  meter: HTMLDivElement;
  fill: HTMLDivElement;
  ghost: HTMLDivElement;
  ballMark: HTMLDivElement;
  holeMark: HTMLDivElement;
  banner: HTMLDivElement;
  pop: HTMLDivElement;
  popTimer: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

export const meters = (units: number) => `${(units * 0.2).toFixed(1).replace('.', ',')} m`;

/** DOM overlay drawn on top of each split-screen view. */
export class Hud {
  readonly root: HTMLDivElement;
  private panes: Pane[] = [];
  private center: HTMLDivElement;

  constructor() {
    this.root = el('div', 'hud', document.body);
    for (let i = 0; i < 2; i++) {
      const root = el('div', `pane p${i}`, this.root);
      root.style.setProperty('--pc', PLAYER_CSS[i]);
      const tag = el('div', 'tag', root, `<b>${PLAYER_NAMES[i]}</b>`);
      const strokes = el('span', 'strokes', tag);
      const dist = el('div', 'dist', root);
      const meter = el('div', 'meter', root);
      const fill = el('div', 'fill', meter);
      const ghost = el('div', 'ghost', meter);
      el('div', 'label', meter, 'MOČ');
      const ballMark = el('div', 'mark ball', root, '<i></i>');
      const holeMark = el('div', 'mark hole', root, '<i></i>');
      const banner = el('div', 'banner', root);
      const pop = el('div', 'pop', root);
      this.panes.push({ root, strokes, dist, meter, fill, ghost, ballMark, holeMark, banner, pop, popTimer: 0 });
    }
    this.center = el('div', 'center', this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('off', !on);
  }

  layout(rects: Rect[]): void {
    rects.forEach((r, i) => {
      const s = this.panes[i].root.style;
      s.left = `${r[0]}px`;
      s.top = `${r[1]}px`;
      s.width = `${r[2]}px`;
      s.height = `${r[3]}px`;
    });
  }

  update(i: number, d: { strokes: number; dist: number; charge: number | null; lastCharge: number; sunk: boolean }, dt: number): void {
    const p = this.panes[i];
    p.strokes.textContent = `udarci ${d.strokes}`;
    p.dist.textContent = d.sunk ? 'v odtoku!' : `do luknje ${meters(d.dist)}`;
    p.meter.classList.toggle('on', d.charge !== null);
    if (d.charge !== null) p.fill.style.height = `${(d.charge * 100).toFixed(1)}%`;
    p.ghost.style.bottom = `${(d.lastCharge * 100).toFixed(1)}%`;
    if (p.popTimer > 0) {
      p.popTimer -= dt;
      if (p.popTimer <= 0) p.pop.classList.remove('on');
    }
  }

  popup(i: number, text: string, big = false): void {
    const p = this.panes[i];
    p.pop.textContent = text;
    p.pop.classList.remove('on', 'big');
    void p.pop.offsetWidth;
    p.pop.classList.add('on');
    p.pop.classList.toggle('big', big);
    p.popTimer = 1.1;
  }

  banner(i: number, html: string | null, kind = ''): void {
    const b = this.panes[i].banner;
    if (html === null) {
      b.className = 'banner';
      b.innerHTML = '';
      return;
    }
    b.innerHTML = html;
    b.className = `banner on ${kind}`;
  }

  centerText(html: string | null, cls = ''): void {
    this.center.innerHTML = html ?? '';
    this.center.className = `center ${html ? 'on' : ''} ${cls}`;
  }

  /** Place a marker over a world point, or clamp it to the pane edge as an arrow when off screen. */
  marker(i: number, which: 'ball' | 'hole', world: Vec3, viewProj: Mat4, rect: Rect, show: boolean): void {
    const m = which === 'ball' ? this.panes[i].ballMark : this.panes[i].holeMark;
    if (!show) {
      m.style.display = 'none';
      return;
    }
    m.style.display = '';
    const c = mat4.transformPoint(viewProj, world);
    let x = c[0] / c[3];
    let y = c[1] / c[3];
    const behind = c[3] < 0.05;
    if (behind) {
      x = -x;
      y = -y;
    }
    const inside = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
    let ang = 0;
    if (!inside) {
      const k = 1 / Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.84, 1e-3);
      if (behind && Math.abs(y) < 0.84) y = -0.84;
      ang = Math.atan2(x, -y);
      x *= k;
      y *= k;
      x = Math.max(-0.9, Math.min(0.9, x));
      y = Math.max(-0.84, Math.min(0.84, y));
    }
    const px = ((x + 1) / 2) * rect[2];
    const py = ((1 - y) / 2) * rect[3];
    m.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    m.classList.toggle('edge', !inside);
    (m.firstElementChild as HTMLElement).style.transform = inside ? '' : `rotate(${ang}rad)`;
  }
}
