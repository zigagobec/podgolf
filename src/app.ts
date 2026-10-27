import { Sfx } from './audio/sfx';
import { Bot } from './game/bot';
import { ChaseCam, type CamMode } from './game/camera';
import { BALL_R, NO_INPUT, World, type GameEvent, type RatInput } from './game/world';
import { Input } from './input';
import { PLAYER_COLORS, PLAYER_NAMES } from './materials';
import { forwardOf, v3, type Vec3 } from './math';
import { buildMeshes } from './render/meshes';
import { linear, Particles, SHAPE } from './render/particles';
import { Renderer, type ViewParams } from './render/renderer';
import { SceneBuilder } from './render/scene';
import type { Gpu } from './render/gpu';
import { Hud, type Rect } from './ui/hud';
import { Menu } from './ui/menu';

type Phase = 'title' | 'intro' | 'play' | 'won';

const INTRO_TIME = 3.2;
const HIT_WORDS = ['BAM!', 'ŠVIGNI!', 'PLONK!', 'TOČ!'];

export class App {
  world = new World();
  private renderer: Renderer;
  private scene: SceneBuilder;
  private particles = new Particles();
  private cams: ChaseCam[];
  readonly input = new Input();
  readonly sfx = new Sfx();
  private hud = new Hud();
  readonly menu: Menu;
  private bot = new Bot(1);
  private botOn = false;
  phase: Phase = 'title';
  private phaseT = 0;
  private paused = false;
  private last = 0;
  private flash = [0, 0];
  private lastCharge = [0, 0];
  private countdownShown = -1;
  private moteTimer = 0;
  private sparkleTimer = 0;
  /** Test hook: when set, frames advance by this fixed dt instead of wall time. */
  fixedDt: number | null = null;
  inputs: RatInput[] = [NO_INPUT, NO_INPUT];

  constructor(private gpu: Gpu) {
    this.renderer = new Renderer(gpu, buildMeshes(this.world.course));
    this.scene = new SceneBuilder(this.world.course);
    this.cams = [new ChaseCam(this.world), new ChaseCam(this.world)];
    this.menu = new Menu((bot) => {
      this.botOn = bot;
    });
    this.toTitle();
    addEventListener('keydown', (e) => {
      this.sfx.unlock();
      if (e.code === 'KeyM') this.sfx.setMuted(!this.sfx.muted);
      if (e.code === 'KeyN') this.sfx.musicOn = !this.sfx.musicOn;
      if (e.code === 'KeyB' && this.phase === 'title') this.menu.toggleBot();
      if (e.code === 'Escape' && (this.phase === 'play' || this.phase === 'intro' || this.phase === 'won')) {
        this.paused = !this.paused;
        this.menu.showPause(this.paused);
      }
      if (this.paused && e.code === 'KeyR') this.unpauseAnd(() => this.startMatch());
      if (this.paused && e.code === 'KeyQ') this.unpauseAnd(() => this.toTitle());
    });
    addEventListener('pointerdown', () => this.sfx.unlock());
  }

  private unpauseAnd(fn: () => void): void {
    this.paused = false;
    this.menu.showPause(false);
    fn();
  }

  toTitle(): void {
    this.phase = 'title';
    this.phaseT = 0;
    this.world = new World();
    this.resetWorldRefs();
    this.menu.show(true);
    this.hud.show(false);
  }

  startMatch(): void {
    this.world = new World();
    this.resetWorldRefs();
    this.world.controlsEnabled = false;
    this.phase = 'intro';
    this.phaseT = 0;
    this.countdownShown = -1;
    this.menu.show(false);
    this.hud.show(true);
    this.hud.banner(0, null);
    this.hud.banner(1, null);
    this.bot.reset();
    this.lastCharge = [0, 0];
    this.particles.clear();
    this.cams.forEach((c, i) => c.snapTo(this.world.rats[i]));
    this.input.flush();
  }

  private resetWorldRefs(): void {
    const w = this.world;
    this.scene = new SceneBuilder(w.course);
    this.cams = [new ChaseCam(w), new ChaseCam(w)];
    this.cams.forEach((c, i) => c.snapTo(w.rats[i]));
  }

  frame(now: number): void {
    let dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (this.fixedDt !== null) dt = this.fixedDt;
    if (this.paused) dt = 0;
    this.phaseT += dt;
    const w = this.world;

    // Inputs.
    for (let i = 0; i < 2; i++) this.inputs[i] = this.input.read(i);
    if (this.botOn && this.phase !== 'title') this.inputs[1] = this.input.override[1] ?? this.bot.think(w, dt);

    switch (this.phase) {
      case 'title':
        if (this.input.tapped(0)) this.menu.setReady(0, !this.menu.ready[0]);
        if (this.input.tapped(1)) this.menu.setReady(1, !this.menu.ready[1]);
        if (this.menu.ready[0] && this.menu.ready[1]) this.startMatch();
        w.advance(dt, [NO_INPUT, NO_INPUT]);
        break;
      case 'intro': {
        const left = Math.ceil(INTRO_TIME - this.phaseT - 0.2);
        if (left !== this.countdownShown && left >= 0) {
          this.countdownShown = left;
          if (left > 0) {
            this.hud.centerText(`<span>${left}</span>`, 'count');
            this.sfx.beep(false);
          }
        }
        if (this.phaseT >= INTRO_TIME - 0.2 && this.countdownShown !== -2) {
          this.countdownShown = -2;
          this.hud.centerText('<span>GREMO!</span>', 'count go');
          this.sfx.beep(true);
        }
        w.advance(dt, this.inputs);
        if (this.phaseT >= INTRO_TIME) {
          this.phase = 'play';
          this.phaseT = 0;
          w.controlsEnabled = true;
          setTimeout(() => this.phase === 'play' && this.hud.centerText(null), 600);
        }
        break;
      }
      case 'play':
        w.advance(dt, this.inputs);
        if (w.winner !== null) this.win(w.winner);
        break;
      case 'won':
        w.advance(dt, this.inputs);
        if (this.phaseT > 2.2) {
          if (this.phaseT - dt <= 2.2) this.hud.centerText('<small>Za revanšo pritisni <span class="k">SPACE</span> ali <span class="k">ENTER</span></small>', 'again');
          if (this.input.tapped(0) || this.input.tapped(1)) this.startMatch();
        }
        break;
    }
    if (this.phase !== 'title') {
      // Drop stale taps so they can't trigger a restart later.
      this.input.tapped(0);
      this.input.tapped(1);
    }

    for (const e of w.drainEvents()) this.onEvent(e);
    this.ambient(dt);
    this.particles.update(dt);
    this.audioFrame();
    this.draw(dt);
  }

  private win(p: number): void {
    this.phase = 'won';
    this.phaseT = 0;
    const loser = 1 - p;
    const r = this.world.rats[p];
    this.hud.banner(p, `<div class="big">ZMAGA!</div><div>${PLAYER_NAMES[p]} v ${r.strokes} ${strokesWord(r.strokes)}</div>`, 'win');
    this.hud.banner(loser, `<div class="big">Ojoj …</div><div>${PLAYER_NAMES[p]} ima žogico že v odtoku</div>`, 'lose');
    this.flash[p] = 0.7;
    this.sfx.setCharge(0, null);
    this.sfx.setCharge(1, null);
  }

  private onEvent(e: GameEvent): void {
    const P = this.particles;
    switch (e.type) {
      case 'hit': {
        this.sfx.hit(e.power, e.player);
        this.cams[e.player].shake = 0.35 + e.power * 0.75;
        this.scene.looks[e.player].kick(0.6 + e.power);
        const col = linear(PLAYER_COLORS[e.player]);
        P.spawn([e.pos[0], 0.03, e.pos[2]], { shape: SHAPE.ring, flat: true, size: 0.2, size1: 1.4 + e.power * 1.6, life: 0.35, color: [1.5, 1.4, 1.2], additive: true });
        const n = 8 + Math.round(e.power * 14);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 2 + Math.random() * 5 * (0.4 + e.power);
          P.spawn(e.pos, { vel: [Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s], shape: SHAPE.star, size: 0.09 + Math.random() * 0.06, life: 0.4 + Math.random() * 0.3, color: v3.scale(col, 2.5), additive: true, drag: 4, spin: 8 });
        }
        for (let i = 0; i < 5; i++) P.spawn([e.pos[0], 0.15, e.pos[2]], { vel: [(Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2], size: 0.25, size1: 0.6, life: 0.6, color: [0.35, 0.32, 0.3], alpha: 0.5, drag: 3 });
        if (e.power > 0.9) {
          this.hud.popup(e.player, 'MOČNO!', true);
          this.flash[e.player] = 0.25;
        } else if (e.power > 0.35) this.hud.popup(e.player, HIT_WORDS[Math.floor(Math.random() * HIT_WORDS.length)]);
        if (e.ball !== e.player) this.hud.popup(e.player, 'Napačna žogica! 😈');
        break;
      }
      case 'lunge':
        this.sfx.squeak(e.player, 0.9 + e.power * 0.3);
        this.lastCharge[e.player] = e.power;
        for (let i = 0; i < 4; i++) P.spawn([e.pos[0], 0.1, e.pos[2]], { vel: [(Math.random() - 0.5) * 1.5, 0.5, (Math.random() - 0.5) * 1.5], size: 0.15, size1: 0.45, life: 0.45, color: [0.3, 0.28, 0.27], alpha: 0.45, drag: 3 });
        break;
      case 'bounce':
        this.sfx.bounce(e.tag, e.speed);
        if (e.speed > 4) {
          for (let i = 0; i < 4; i++) P.spawn(e.pos, { vel: [(Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3], shape: SHAPE.glow, size: 0.12, life: 0.25, color: [1.6, 1.4, 1.0], additive: true, drag: 5 });
        }
        if (e.tag === 'sponge') P.spawn(e.pos, { shape: SHAPE.ring, size: 0.2, size1: 1.2, life: 0.3, color: [0.8, 1.6, 0.6], additive: true });
        break;
      case 'clack':
        this.sfx.clack(e.speed);
        for (let i = 0; i < 6; i++) P.spawn(e.pos, { vel: [(Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5], shape: SHAPE.star, size: 0.08, life: 0.3, color: [2, 2, 1.6], additive: true, drag: 4 });
        break;
      case 'bonk': {
        this.sfx.bonk(e.victim);
        this.cams[e.victim].shake = 1;
        this.flash[e.victim] = 0.3;
        this.hud.popup(e.victim, 'BONK! 💫', true);
        this.hud.popup(e.attacker, 'Pozor, podgana!');
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          P.spawn([e.pos[0], e.pos[1] + 0.3, e.pos[2]], { vel: [Math.cos(a) * 4, 2, Math.sin(a) * 4], shape: SHAPE.star, size: 0.16, life: 0.6, color: [1.8, 1.6, 0.4], drag: 3, spin: 6 });
        }
        break;
      }
      case 'lip':
        this.sfx.lip();
        this.hud.popup(this.world.balls.findIndex((b) => v3.dist(b.pos, e.pos) < 0.5) === 1 ? 1 : 0, 'Uf, rob!');
        break;
      case 'sink': {
        this.sfx.sink(e.ball);
        const h = this.world.course.hole;
        for (let i = 0; i < 120; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 2 + Math.random() * 6;
          const pal: Vec3[] = [[1, 0.3, 0.25], [0.3, 0.65, 1], [1, 0.85, 0.2], [0.35, 1, 0.5], [1, 1, 1]];
          P.spawn([h.x, 0.3, h.z], { vel: [Math.cos(a) * s * 0.5, 5 + Math.random() * 7, Math.sin(a) * s * 0.5], shape: SHAPE.square, size: 0.09, life: 2.5 + Math.random(), color: linear(pal[i % pal.length]), gravity: 9, drag: 1.2, spin: (Math.random() - 0.5) * 20 });
        }
        P.spawn([h.x, 0.05, h.z], { shape: SHAPE.ring, flat: true, size: 0.4, size1: 4, life: 0.6, color: [0.6, 2.2, 1.0], additive: true });
        break;
      }
      case 'respawn':
        this.sfx.respawn();
        this.hud.popup(e.ball, 'Žogica nazaj na start');
        break;
    }
  }

  private ambient(dt: number): void {
    const P = this.particles;
    const w = this.world;
    // Dust motes drifting through the lamp light.
    this.moteTimer -= dt;
    if (this.moteTimer <= 0) {
      this.moteTimer = 0.08;
      P.spawn([-20 + Math.random() * 40, 0.3 + Math.random() * 4, -13 + Math.random() * 26], { vel: [(Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2], shape: SHAPE.glow, size: 0.05, life: 6, color: [0.6, 0.55, 0.45], alpha: 0.6, additive: true, drag: 0 });
    }
    // Sparkles rising from the drain.
    this.sparkleTimer -= dt;
    const h = w.course.hole;
    if (this.sparkleTimer <= 0) {
      this.sparkleTimer = 0.12;
      const a = Math.random() * Math.PI * 2;
      P.spawn([h.x + Math.cos(a) * 0.3, w.course.rimY(), h.z + Math.sin(a) * 0.3], { vel: [0, 0.8 + Math.random() * 0.6, 0], shape: SHAPE.glow, size: 0.07, life: 1.4, color: [0.3, 1.6, 0.7], additive: true, drag: 0.5 });
    }
    for (const b of w.balls) {
      const sp = Math.hypot(b.vel[0], b.vel[2]);
      if (sp > 5 && !b.sunk) P.spawn(b.pos, { shape: SHAPE.glow, size: 0.22, size1: 0.05, life: 0.3, color: v3.scale(linear(PLAYER_COLORS[b.owner]), 1.5), alpha: Math.min(1, sp / 15), additive: true, drag: 0 });
    }
    for (const r of w.rats) {
      const sp = Math.hypot(r.vel[0], r.vel[2]);
      if (sp > 3 && Math.random() < dt * 8) {
        const f = forwardOf(r.yaw);
        P.spawn([r.pos[0] - f[0] * 0.4, 0.05, r.pos[2] - f[2] * 0.4], { vel: [-f[0] * 0.5, 0.4, -f[2] * 0.5], size: 0.08, size1: 0.25, life: 0.5, color: [0.32, 0.3, 0.28], alpha: 0.35, drag: 2 });
      }
      // Aim guide while charging.
      if (r.charging) {
        const f = forwardOf(r.yaw);
        const n = 7;
        const lit = r.charge * n;
        const col = linear(PLAYER_COLORS[r.id]);
        const snout = w.snoutOf(r);
        for (let k = 0; k < n; k++) {
          const d = 0.55 + k * 0.42;
          const on = k < lit;
          P.now([snout[0] + f[0] * d, w.course.floorY(snout[0] + f[0] * d, snout[2] + f[2] * d) + 0.025, snout[2] + f[2] * d], 0.2, on ? v3.scale(col, 2.2) : [0.5, 0.5, 0.5], on ? 0.95 : 0.25, SHAPE.chevron, -r.yaw, true, on);
        }
      }
      if (r.stun > 0) {
        for (let k = 0; k < 3; k++) {
          const a = w.time * 6 + (k * Math.PI * 2) / 3;
          P.now([r.pos[0] + Math.cos(a) * 0.35, r.pos[1] + 0.55, r.pos[2] + Math.sin(a) * 0.35], 0.12, [2, 1.8, 0.5], 1, SHAPE.star, w.time * 4);
        }
      }
    }
    // Ball locator glow under each ball so it reads from afar.
    for (const b of w.balls) {
      if (b.sunk) continue;
      P.now([b.pos[0], w.course.floorY(b.pos[0], b.pos[2]) + 0.02, b.pos[2]], 0.5, v3.scale(linear(PLAYER_COLORS[b.owner]), 0.9), 0.55, SHAPE.glow, 0, true, true);
    }
  }

  private audioFrame(): void {
    const w = this.world;
    w.balls.forEach((b, i) => this.sfx.setRoll(i, Math.hypot(b.vel[0], b.vel[2]), b.grounded && !b.sunk));
    w.rats.forEach((r, i) => this.sfx.setCharge(i, r.charging && this.phase === 'play' ? r.charge : null));
    if (this.phase !== 'title') this.sfx.tickMusic(this.phase === 'play' && w.balls.some((b) => Math.hypot(b.pos[0] - w.course.hole.x, b.pos[2] - w.course.hole.z) < 6));
  }

  private viewRects(): { rects: Rect[]; split: number } {
    const c = this.gpu.canvas;
    const W = c.width, H = c.height;
    if (this.phase === 'title') return { rects: [[0, 0, W, H]], split: 2 };
    if (W >= H) {
      const h = Math.floor(W / 2);
      return { rects: [[0, 0, h, H], [h, 0, W - h, H]], split: 0 };
    }
    const h = Math.floor(H / 2);
    return { rects: [[0, 0, W, h], [0, h, W, H - h]], split: 1 };
  }

  private draw(dt: number): void {
    const w = this.world;
    const { rects, split } = this.viewRects();
    const t = this.phaseT;
    const views: ViewParams[] = [];
    for (let i = 0; i < rects.length; i++) {
      const cam = this.cams[i];
      let mode: CamMode = 'chase';
      if (this.phase === 'title') mode = 'title';
      else if (this.phase === 'intro') mode = 'intro';
      else if (this.phase === 'won' && w.winner === i) mode = 'orbit';
      const introT = this.phase === 'intro' ? (t - 0.3) / (INTRO_TIME - 0.9) : 1;
      cam.update(dt, w.rats[i], mode, mode === 'intro' ? introT : this.phase === 'title' ? w.time : t);
      const rect = rects[i];
      const m = cam.matrices(rect[2] / rect[3], w.time);
      this.flash[i] = Math.max(0, this.flash[i] - dt * 2.5);
      const lost = this.phase === 'won' && w.winner !== i;
      views.push({
        viewProj: m.viewProj,
        camPos: m.pos,
        camRight: m.right,
        camUp: m.up,
        rect,
        flash: this.flash[i],
        saturation: lost ? Math.max(0.25, 1 - t * 0.6) : 1,
        darken: lost ? Math.min(0.25, t * 0.15) : 0,
      });
    }
    this.scene.build(w, this.inputs.map((x) => x.steer), dt);
    const packed = { data: this.instData };
    const { ranges, total } = this.scene.inst.pack(packed);
    this.instData = packed.data;
    this.particles.pack();
    const h = w.course.hole;
    this.renderer.render({
      instances: this.instData,
      instanceCount: total,
      ranges,
      particles: this.particles.data,
      particleCount: this.particles.count,
      lights: this.scene.lights(w),
      views,
      time: w.time,
      split,
      hole: { x: h.x, y: w.course.rimY(), z: h.z, r: h.r, funnelR: h.funnelR, depth: h.cupDepth },
    });

    // HUD in CSS pixels.
    if (this.phase !== 'title') {
      const dpr = this.gpu.canvas.width / this.gpu.canvas.clientWidth || 1;
      const css = rects.map((r) => r.map((v) => v / dpr) as Rect);
      this.hud.layout(css);
      for (let i = 0; i < 2; i++) {
        const r = w.rats[i];
        const b = w.balls[i];
        this.hud.update(i, {
          strokes: r.strokes,
          dist: Math.hypot(b.pos[0] - h.x, b.pos[2] - h.z),
          charge: r.charging ? r.charge : null,
          lastCharge: this.lastCharge[i],
          sunk: b.sunk,
        }, dt);
        const vp = views[i].viewProj;
        const ballFar = v3.dist(b.pos, r.pos) > 5;
        this.hud.marker(i, 'ball', [b.pos[0], b.pos[1] + BALL_R + 0.35, b.pos[2]], vp, css[i], !b.sunk && (ballFar || this.phase === 'intro'));
        this.hud.marker(i, 'hole', [h.x, 1.2, h.z], vp, css[i], this.phase !== 'won');
      }
    }
  }

  private instData = new Float32Array(1024 * 36);
}

function strokesWord(n: number): string {
  const m = n % 100;
  if (m === 1) return 'udarcu';
  return 'udarcih';
}
