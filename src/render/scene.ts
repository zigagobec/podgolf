import type { Course } from '../game/course';
import { BALL_R, RAT_R, type Rat, type World } from '../game/world';
import { MAT, PLAYER_COLORS } from '../materials';
import { forwardOf, m3, v3, type Mat3, type Vec3 } from '../math';
import { IDENTITY, Instances } from './instances';
import type { PointLight } from './renderer';

const FUR: Vec3[] = [
  [0.6, 0.5, 0.43],
  [0.6, 0.6, 0.64],
];
const SKIN: Vec3 = [0.98, 0.64, 0.66];
const NOSE: Vec3 = [0.96, 0.42, 0.52];

/** Per-rat animation state that lives outside the simulation. */
export class RatLook {
  squashY = 1;
  squashV = 0;
  stretchZ = 1;
  stretchV = 0;
  headYaw = 0;
  blink = 0;
  nextBlink = 2 + Math.random() * 3;
  tailPhase = Math.random() * 10;

  update(r: Rat, steer: number, dt: number): void {
    let ty = 1, tz = 1;
    if (r.charging) {
      ty = 0.86 - r.charge * 0.06;
      tz = 1.05;
    } else if (r.lungeT > 0) {
      ty = 0.92;
      tz = 1.22;
    }
    // Under-damped springs give a bit of jiggle.
    this.squashV += ((ty - this.squashY) * 260 - this.squashV * 14) * dt;
    this.squashY += this.squashV * dt;
    this.stretchV += ((tz - this.stretchZ) * 260 - this.stretchV * 14) * dt;
    this.stretchZ += this.stretchV * dt;
    this.headYaw += (steer * 0.3 - this.headYaw) * Math.min(1, dt * 8);
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.12;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    const speed = Math.hypot(r.vel[0], r.vel[2]);
    this.tailPhase += dt * (3 + speed * 1.5);
  }

  kick(amount: number): void {
    this.squashV -= amount * 6;
    this.stretchV += amount * 6;
  }
}

export class SceneBuilder {
  readonly inst = new Instances();
  private staticInst = new Instances();
  readonly looks = [new RatLook(), new RatLook()];

  constructor(private course: Course) {
    this.buildStatic();
  }

  private buildStatic(): void {
    const S = this.staticInst;
    const c = this.course;
    S.add('floor', [0, 0, 0], IDENTITY, [1, 1, 1], [1, 1, 1], MAT.tiles, { noShadow: true });
    for (const b of c.bodies) {
      if (!b.look) continue;
      const lk = b.look;
      const o = { param: lk.param ?? 0 };
      const sh = b.shape;
      if (sh.kind === 'box') S.add('box', sh.c, sh.rot, [sh.h[0] * 2, sh.h[1] * 2, sh.h[2] * 2], lk.color, lk.mat, o);
      else if (sh.kind === 'cyl') S.add('cyl', sh.c, IDENTITY, [sh.r * 2, sh.hh * 2, sh.r * 2], lk.color, lk.mat, o);
      else {
        const axis = v3.sub(sh.b, sh.a);
        const len = v3.len(axis);
        const rot = m3.basis(axis, [0, 1, 0]);
        S.add('cyl', v3.lerp(sh.a, sh.b, 0.5), rot, [sh.r * 2, len, sh.r * 2], lk.color, lk.mat, o);
        S.add('sphere', sh.a, rot, [sh.r * 2, sh.r * 2, sh.r * 2], lk.color, lk.mat, o);
        S.add('sphere', sh.b, rot, [sh.r * 2, sh.r * 2, sh.r * 2], lk.color, lk.mat, o);
      }
    }
    for (const p of c.props) S.add(p.mesh, p.t, p.rot, p.s, p.look.color, p.look.mat, { param: p.look.param ?? 0, noShadow: p.noShadow || p.s[1] < 0.05 });
    // The cup.
    const h = c.hole;
    const rim = c.rimY();
    S.add('cupWall', [h.x, rim, h.z], IDENTITY, [h.r, h.cupDepth + 0.02, h.r], [1, 1, 1], MAT.cup, { noShadow: true });
    S.add('cyl', [h.x, rim - h.cupDepth - 0.01, h.z], IDENTITY, [h.r * 2, 0.02, h.r * 2], [1, 1, 1], MAT.drain, { noShadow: true });
    // Night-light in the outlet.
    S.add('sphere', [-6, 1.75, 12.98], IDENTITY, [0.5, 0.5, 0.2], [1, 0.75, 0.4], MAT.glow, { param: 3, noShadow: true });
  }

  build(w: World, steer: number[], dt: number): void {
    const I = this.inst;
    I.copyFrom(this.staticInst);
    for (let i = 0; i < w.rats.length; i++) {
      this.looks[i].update(w.rats[i], steer[i] ?? 0, dt);
      this.rat(w.rats[i], this.looks[i], w.time);
    }
    for (const b of w.balls) {
      I.add('sphere', b.pos, m3.fromQuat(b.rot), [BALL_R * 2, BALL_R * 2, BALL_R * 2], PLAYER_COLORS[b.owner], MAT.ball);
    }
    this.spoon();
    this.flag(w);
  }

  private spoon(): void {
    const sp = this.course.spoon;
    const f = forwardOf(sp.angle);
    const wood: Vec3 = [0.82, 0.62, 0.4];
    const rot = m3.basis(f, [0, 1, 0]);
    const mid = v3.addScaled(sp.pivot, f, sp.len / 2 + 0.1);
    this.inst.add('cyl', mid, m3.mul(rot, m3.fromEuler(0, 0, 0)), [0.34, sp.len, 0.2], wood, MAT.wood);
    const yawRot = m3.fromEuler(sp.angle);
    this.inst.add('sphere', v3.addScaled(sp.pivot, f, sp.len + 0.35), yawRot, [1.0, 0.4, 1.25], wood, MAT.wood);
  }

  private flag(w: World): void {
    const h = this.course.hole;
    const rim = this.course.rimY();
    // The pin lifts out when a ball gets close, like a caddie pulling it.
    let near = 99;
    for (const b of w.balls) if (!b.sunk) near = Math.min(near, Math.hypot(b.pos[0] - h.x, b.pos[2] - h.z));
    const lift = Math.max(0, Math.min(1, (3.2 - near) / 1.5)) * 1.8;
    const bottom = rim - 0.4 + lift;
    const top = 3.6 + lift;
    this.inst.add('cyl', [h.x, (bottom + top) / 2, h.z], IDENTITY, [0.08, top - bottom, 0.08], [0.95, 0.85, 0.62], MAT.wood, { param: 1 });
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const u = (i + 0.5) / segs;
      const wave = Math.sin(w.time * 6 - u * 4) * 0.12 * u;
      const ang = Math.cos(w.time * 6 - u * 4) * 0.35 * u;
      this.inst.add('box', [h.x + 0.08 + u * 0.95, top - 0.35, h.z + wave], m3.fromEuler(ang), [0.95 / segs + 0.02, 0.6 * (1 - u * 0.3), 0.03], [1, 0.82, 0.2], MAT.plain, { emissive: 0.25 });
    }
    // Target ring on the floor.
    const pulse = 0.5 + 0.5 * Math.sin(w.time * 3);
    this.inst.add('torus', [h.x, rim + 0.03, h.z], IDENTITY, [h.r * 2 + 0.5 + pulse * 0.1, 0.25, h.r * 2 + 0.5 + pulse * 0.1], [0.3, 1, 0.55], MAT.glow, { param: 1.2 + pulse, noShadow: true });
  }

  private rat(r: Rat, look: RatLook, time: number): void {
    const I = this.inst;
    const f = forwardOf(r.yaw);
    const R = m3.basis(r.groundN, f);
    const wobble = r.stun > 0 ? Math.sin(time * 14) * 0.3 * Math.min(1, r.stun) : 0;
    const Rw = wobble ? m3.mul(R, m3.fromEuler(0, 0, wobble)) : R;
    const root = v3.addScaled(r.pos, r.groundN, -RAT_R);
    const fur = FUR[r.id];
    const team = PLAYER_COLORS[r.id];
    const sq = look.squashY;
    const st = look.stretchZ;
    const sx = 1 / Math.sqrt(Math.max(0.5, sq * st));
    const speed = Math.hypot(r.vel[0], r.vel[2]);
    const moving = Math.min(1, speed / 3);
    const bob = Math.abs(Math.sin(r.stride * 4.5)) * 0.035 * moving;
    const wiggle = r.charging ? Math.sin(time * 30) * 0.03 * (0.3 + r.charge) : 0;

    const part = (mesh: 'sphere' | 'cyl' | 'box', p: Vec3, rot: Mat3, s: Vec3, color: Vec3, mat: number, emissive = 0) => {
      const lp: Vec3 = [p[0] * sx, p[1] * sq + bob, p[2] * st];
      I.add(mesh, v3.add(root, m3.apply(Rw, lp)), m3.mul(Rw, rot), [s[0] * sx, s[1] * sq, s[2] * st], color, mat, { param: r.id, emissive });
    };

    part('sphere', [wiggle, 0.36, -0.08], IDENTITY, [0.64, 0.58, 1.0], fur, MAT.fur);
    // Head turns a little with steering.
    const H = m3.fromEuler(look.headYaw);
    const hp = (p: Vec3): Vec3 => {
      const pivot: Vec3 = [0, 0.42, 0.2];
      const q = m3.apply(H, v3.sub(p, pivot));
      return v3.add(pivot, q);
    };
    const sniff = speed < 0.3 && !r.charging ? Math.sin(time * 14) * 0.012 : 0;
    part('sphere', hp([0, 0.44, 0.38]), H, [0.46, 0.42, 0.5], fur, MAT.fur);
    part('sphere', hp([0, 0.39 + sniff, 0.62]), H, [0.26, 0.24, 0.36], fur, MAT.fur);
    part('sphere', hp([0, 0.41 + sniff, 0.8]), H, [0.11, 0.09, 0.08], NOSE, MAT.skin);
    const eyeY = look.blink > 0 ? 0.15 : 1;
    for (const sgn of [-1, 1]) {
      part('sphere', hp([0.13 * sgn, 0.52, 0.56]), H, [0.09, 0.09 * eyeY, 0.09], [0.03, 0.02, 0.03], MAT.eye);
      if (look.blink <= 0) part('sphere', hp([0.14 * sgn, 0.545, 0.6]), H, [0.032, 0.032, 0.032], [1, 1, 1], MAT.glow, 0);
      const ear = m3.mul(H, m3.fromEuler(-0.35 * sgn, 0, 0.3 * sgn));
      part('sphere', hp([0.19 * sgn, 0.64, 0.33]), ear, [0.26, 0.28, 0.07], fur, MAT.fur);
      part('sphere', v3.add(hp([0.19 * sgn, 0.64, 0.33]), m3.apply(ear, [0, 0, 0.02])), ear, [0.18, 0.2, 0.05], SKIN, MAT.skin);
      for (const k of [0, 1]) {
        const wr = m3.mul(H, m3.fromEuler(sgn * (0.2 - k * 0.35), 0, sgn * (0.12 - k * 0.2)));
        part('box', v3.add(hp([0.13 * sgn, 0.4, 0.74]), m3.apply(wr, [0.17 * sgn, 0, 0])), wr, [0.34, 0.012, 0.012], [0.12, 0.1, 0.1], MAT.plain);
      }
      // Paws with a trotting cycle.
      const ph = r.stride * 4.5;
      const legs: [number, number, number][] = [[0.2, 0.24, 0], [0.22, -0.34, Math.PI]];
      for (const [x, z, off] of legs) {
        const a = ph + off + (sgn > 0 ? Math.PI : 0);
        const dz = Math.sin(a) * 0.13 * moving;
        const dy = Math.max(0, Math.cos(a)) * 0.07 * moving;
        part('sphere', [x * sgn, 0.06 + dy - bob, z + dz], IDENTITY, [0.14, 0.11, 0.2], SKIN, MAT.skin);
      }
    }
    // Cap in team colour.
    part('sphere', hp([0, 0.6, 0.36]), H, [0.44, 0.26, 0.46], team, MAT.plain);
    part('cyl', hp([0, 0.6, 0.56]), m3.mul(H, m3.fromEuler(0, 0.15)), [0.38, 0.03, 0.3], team.map((c) => c * 0.8) as Vec3, MAT.plain);
    part('sphere', hp([0, 0.73, 0.36]), H, [0.08, 0.08, 0.08], [1, 1, 1], MAT.plain);

    // Tail: a chain of tapering segments.
    let p: Vec3 = [0, 0.3, -0.56];
    let yaw = Math.PI;
    let pitch = r.charging ? -0.35 : -0.25;
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      // While charging the tail lashes side to side instead of curling up into the camera.
      yaw += Math.sin(look.tailPhase + i * 0.55) * (r.charging ? 0.2 : 0.12) + wiggle * 2;
      pitch += 0.07;
      const dir: Vec3 = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      const len = 0.13;
      const rad = 0.055 - (0.035 * i) / segs;
      const mid = v3.addScaled(p, dir, len / 2);
      part('cyl', mid, m3.basis(dir, [0, 1, 0]), [rad * 2, len * 1.15, rad * 2], SKIN, MAT.skin);
      p = v3.addScaled(p, dir, len);
      if (p[1] < 0.03) p[1] = 0.03;
    }
  }

  lights(w: World): PointLight[] {
    const h = this.course.hole;
    const L: PointLight[] = [
      { pos: [h.x, this.course.rimY() + 0.4, h.z], radius: 4.5, color: [0.3, 1, 0.5], intensity: 0.9 + 0.3 * Math.sin(w.time * 3) },
      { pos: [19.4, 0.6, 0], radius: 10, color: [1, 0.86, 0.62], intensity: 0.7 },
      { pos: [-6, 1.6, 12.4], radius: 7, color: [1, 0.68, 0.32], intensity: 0.9 },
    ];
    for (const b of w.balls) {
      const c = PLAYER_COLORS[b.owner];
      L.push({ pos: [b.pos[0], b.pos[1] + 0.35, b.pos[2]], radius: 2.4, color: c, intensity: 0.9 });
    }
    return L;
  }
}
