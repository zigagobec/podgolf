import { clamp, forwardOf, quat, v3, type Quat, type Vec3 } from '../math';
import { boundingSphere, sphereContact } from '../physics/shapes';
import { Course, ROOM, type Body } from './course';

export const G = 22;
export const BALL_R = 0.25;
export const RAT_R = 0.36;
export const SNOUT_R = 0.16;
export const SNOUT_FWD = 0.58;
/** Rolling resistance: constant deceleration plus linear damping while on the ground. */
export const ROLL_DECEL = 3;
export const ROLL_DAMP = 0.5;
/** Above this horizontal speed a ball skips over the cup. */
export const LIP_HOP_SPEED = 6.5;
export const CHARGE_TIME = 1.05;
export const LUNGE_TIME = 0.24;
export const HIT_MIN = 3;
export const HIT_MAX = 22;
const WALK_SPEED = 5.5;
const BACK_SPEED = 2.6;
const TURN_RATE = 3.3;
const AIM_TURN_RATE = 1.5;
const COOLDOWN = 0.3;
const STUN_TIME = 1.0;
const FLOOR = { restitution: 0.35, friction: 0 };

export interface RatInput {
  throttle: number;
  steer: number;
  action: boolean;
}

export const NO_INPUT: RatInput = { throttle: 0, steer: 0, action: false };

export interface Ball {
  owner: number;
  pos: Vec3;
  vel: Vec3;
  rot: Quat;
  grounded: boolean;
  sunk: boolean;
  /** Seconds since the ball was last struck by a snout. */
  sinceHit: number;
}

export interface Rat {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  grounded: boolean;
  groundN: Vec3;
  charging: boolean;
  chargePhase: number;
  charge: number;
  lungeT: number;
  lungeCharge: number;
  cooldown: number;
  stun: number;
  strokes: number;
  struck: boolean[];
  prevAction: boolean;
  /** Distance walked, drives the leg animation. */
  stride: number;
}

export type GameEvent =
  | { type: 'hit'; player: number; ball: number; pos: Vec3; power: number }
  | { type: 'lunge'; player: number; pos: Vec3; power: number }
  | { type: 'bounce'; pos: Vec3; speed: number; tag: string }
  | { type: 'clack'; pos: Vec3; speed: number }
  | { type: 'bonk'; attacker: number; victim: number; pos: Vec3 }
  | { type: 'lip'; pos: Vec3; speed: number }
  | { type: 'sink'; ball: number; pos: Vec3 }
  | { type: 'respawn'; ball: number };

/** Charge meter that sweeps 0 → 1 → 0 like a golf power bar. */
export const chargeOf = (phase: number) => 1 - Math.abs((phase % 2) - 1);
export const hitPower = (charge: number) => HIT_MIN + (HIT_MAX - HIT_MIN) * charge;

function resolve(pos: Vec3, vel: Vec3, n: Vec3, depth: number, e: number, fr: number, sv?: Vec3): number {
  pos[0] += n[0] * depth;
  pos[1] += n[1] * depth;
  pos[2] += n[2] * depth;
  const rel: Vec3 = sv ? v3.sub(vel, sv) : v3.copy(vel);
  const vn = v3.dot(rel, n);
  if (vn >= 0) return 0;
  const ee = -vn < 0.9 ? 0 : e;
  const jn = -(1 + ee) * vn;
  rel[0] += n[0] * jn;
  rel[1] += n[1] * jn;
  rel[2] += n[2] * jn;
  if (fr > 0) {
    const vt = v3.addScaled(rel, n, -v3.dot(rel, n));
    const lt = v3.len(vt);
    if (lt > 1e-6) {
      const jt = Math.min(lt, fr * jn);
      rel[0] -= (vt[0] / lt) * jt;
      rel[1] -= (vt[1] / lt) * jt;
      rel[2] -= (vt[2] / lt) * jt;
    }
  }
  const out = sv ? v3.add(rel, sv) : rel;
  vel[0] = out[0];
  vel[1] = out[1];
  vel[2] = out[2];
  return -vn;
}

export class World {
  readonly course = new Course();
  readonly balls: Ball[] = [];
  readonly rats: Rat[] = [];
  time = 0;
  winner: number | null = null;
  events: GameEvent[] = [];
  /** When false, rats ignore input (countdown, menus). */
  controlsEnabled = true;
  private bounceCooldown = new Map<string, number>();

  constructor() {
    for (let i = 0; i < 2; i++) {
      this.balls.push({ owner: i, pos: v3.copy(this.course.tees[i]), vel: [0, 0, 0], rot: quat.identity(), grounded: true, sunk: false, sinceHit: 99 });
      const s = this.course.ratStarts[i];
      this.rats.push({
        id: i, pos: v3.copy(s.pos), vel: [0, 0, 0], yaw: s.yaw, grounded: true, groundN: [0, 1, 0],
        charging: false, chargePhase: 0, charge: 0, lungeT: 0, lungeCharge: 0, cooldown: 0, stun: 0,
        strokes: 0, struck: [false, false], prevAction: false, stride: 0,
      });
    }
  }

  snoutOf(r: Rat): Vec3 {
    const f = forwardOf(r.yaw);
    return [r.pos[0] + f[0] * SNOUT_FWD, r.pos[1] - 0.04, r.pos[2] + f[2] * SNOUT_FWD];
  }

  /** Advance by dt using small sub-steps. */
  advance(dt: number, inputs: RatInput[]): void {
    dt = Math.min(dt, 1 / 20);
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(h, inputs);
  }

  step(h: number, inputs: RatInput[]): void {
    this.time += h;
    this.course.setTime(this.time);
    for (const [k, t] of this.bounceCooldown) {
      if (t - h <= 0) this.bounceCooldown.delete(k);
      else this.bounceCooldown.set(k, t - h);
    }
    for (const r of this.rats) this.stepRat(r, this.controlsEnabled ? inputs[r.id] ?? NO_INPUT : NO_INPUT, h);
    this.ratVsRat();
    for (let i = 0; i < this.balls.length; i++) this.stepBall(i, h);
    this.ballVsBall();
    for (const r of this.rats) for (let i = 0; i < this.balls.length; i++) this.ratVsBall(r, i);
  }

  // ---------------------------------------------------------------- rats

  private stepRat(r: Rat, inp: RatInput, h: number): void {
    if (r.cooldown > 0) r.cooldown -= h;
    if (r.stun > 0) {
      r.stun -= h;
      r.charging = false;
      r.charge = 0;
      r.yaw += 9 * h * Math.max(0, r.stun);
    } else {
      // Charge while held, lunge on release.
      if (inp.action && !r.prevAction && !r.charging && r.lungeT <= 0 && r.cooldown <= 0) {
        r.charging = true;
        r.chargePhase = 0;
      }
      if (r.charging) {
        r.chargePhase += h / CHARGE_TIME;
        r.charge = chargeOf(r.chargePhase);
        if (!inp.action) {
          r.charging = false;
          r.lungeT = LUNGE_TIME;
          r.lungeCharge = Math.max(0.04, r.charge);
          r.struck = [false, false];
          this.events.push({ type: 'lunge', player: r.id, pos: v3.copy(r.pos), power: r.lungeCharge });
          r.charge = 0;
        }
      }
      const turn = r.charging ? AIM_TURN_RATE : TURN_RATE;
      r.yaw += -inp.steer * turn * h;
    }
    r.prevAction = inp.action;

    const fwd = forwardOf(r.yaw);
    let tx: number, tz: number, rate: number;
    if (r.lungeT > 0) {
      r.lungeT -= h;
      const sp = 4 + 9 * r.lungeCharge;
      tx = fwd[0] * sp;
      tz = fwd[2] * sp;
      rate = 40;
      if (r.lungeT <= 0) r.cooldown = COOLDOWN;
    } else if (r.stun > 0) {
      tx = 0;
      tz = 0;
      rate = 2;
    } else {
      const th = clamp(inp.throttle, -1, 1);
      const sp = th >= 0 ? th * WALK_SPEED : th * BACK_SPEED;
      const k = r.charging ? 0.15 : 1;
      tx = fwd[0] * sp * k;
      tz = fwd[2] * sp * k;
      rate = r.grounded ? 14 : 2;
    }
    const a = 1 - Math.exp(-rate * h);
    r.vel[0] += (tx - r.vel[0]) * a;
    r.vel[2] += (tz - r.vel[2]) * a;
    r.vel[1] -= G * h;
    r.pos[0] += r.vel[0] * h;
    r.pos[1] += r.vel[1] * h;
    r.pos[2] += r.vel[2] * h;
    r.stride += Math.hypot(r.vel[0], r.vel[2]) * h;

    // Floor (rats are too big to drop into the drain, they walk over it).
    const c = this.course;
    r.grounded = false;
    const hole = c.hole;
    const dh = Math.hypot(r.pos[0] - hole.x, r.pos[2] - hole.z);
    const fy = dh < hole.r ? c.rimY() : c.floorY(r.pos[0], r.pos[2]);
    const fn = dh < hole.r ? ([0, 1, 0] as Vec3) : c.floorNormal(r.pos[0], r.pos[2]);
    const dist = (r.pos[1] - fy) * fn[1];
    let groundN: Vec3 = [0, 1, 0];
    if (dist < RAT_R) {
      resolve(r.pos, r.vel, fn, RAT_R - dist, 0, 0);
      r.grounded = true;
      groundN = fn;
    }
    for (const b of c.bodies) {
      const ct = this.contact(b, r.pos, RAT_R);
      if (!ct) continue;
      resolve(r.pos, r.vel, ct.n, ct.depth, 0.1, 0, b.velAt?.(ct.p));
      if (ct.n[1] > 0.6) {
        r.grounded = true;
        groundN = ct.n;
      }
    }
    // Shy away from standing in the drain.
    if (dh < hole.r + 0.15 && dh > 1e-4) {
      const push = (hole.r + 0.15 - dh) * Math.min(1, 10 * h);
      r.pos[0] += ((r.pos[0] - hole.x) / dh) * push;
      r.pos[2] += ((r.pos[2] - hole.z) / dh) * push;
    }
    r.groundN = v3.normalize(v3.lerp(r.groundN, groundN, Math.min(1, 12 * h)));
    this.keepInRoom(r.pos, r.vel, RAT_R);
    if (r.pos[1] < -4) {
      const s = c.ratStarts[r.id];
      r.pos = v3.copy(s.pos);
      r.vel = [0, 0, 0];
    }
  }

  private ratVsRat(): void {
    const [a, b] = this.rats;
    for (const [att, vic] of [[a, b], [b, a]] as const) {
      if (att.lungeT <= 0 || vic.stun > 0) continue;
      const s = this.snoutOf(att);
      if (v3.dist(s, vic.pos) < SNOUT_R + RAT_R + 0.05 || v3.dist(att.pos, vic.pos) < RAT_R * 2) {
        const f = forwardOf(att.yaw);
        vic.vel = [f[0] * 9, 4.5, f[2] * 9];
        vic.stun = STUN_TIME;
        vic.charging = false;
        vic.lungeT = 0;
        att.lungeT = 0;
        att.cooldown = COOLDOWN;
        att.vel = v3.scale(att.vel, 0.2);
        this.events.push({ type: 'bonk', attacker: att.id, victim: vic.id, pos: v3.lerp(att.pos, vic.pos, 0.5) });
      }
    }
    const d = v3.sub(b.pos, a.pos);
    d[1] = 0;
    const dist = v3.len(d);
    const min = RAT_R * 2;
    if (dist < min && dist > 1e-6) {
      const n = v3.scale(d, 1 / dist);
      const push = (min - dist) / 2;
      a.pos = v3.addScaled(a.pos, n, -push);
      b.pos = v3.addScaled(b.pos, n, push);
      const rel = v3.dot(v3.sub(b.vel, a.vel), n);
      if (rel < 0) {
        a.vel = v3.addScaled(a.vel, n, rel / 2);
        b.vel = v3.addScaled(b.vel, n, -rel / 2);
      }
    }
  }

  // ---------------------------------------------------------------- balls

  private stepBall(i: number, h: number, b: Ball = this.balls[i]): void {
    const c = this.course;
    const hole = c.hole;
    b.sinceHit += h;
    const sticky = c.stickyAt(b.pos[0], b.pos[2]);
    if (b.grounded) {
      const hv = Math.hypot(b.vel[0], b.vel[2]);
      if (hv > 0) {
        const dec = (ROLL_DECEL * h + hv * ROLL_DAMP * h) * (sticky ? 5 : 1);
        const k = Math.max(0, hv - dec) / hv;
        b.vel[0] *= k;
        b.vel[2] *= k;
      }
    }
    b.vel[1] -= G * h;
    const prev = v3.copy(b.pos);
    b.pos[0] += b.vel[0] * h;
    b.pos[1] += b.vel[1] * h;
    b.pos[2] += b.vel[2] * h;
    b.grounded = false;

    const rimY = c.rimY();
    const dx = b.pos[0] - hole.x;
    const dz = b.pos[2] - hole.z;
    const dh = Math.hypot(dx, dz);
    const ux = dh > 1e-6 ? dx / dh : 1;
    const uz = dh > 1e-6 ? dz / dh : 0;

    if (dh >= hole.r) {
      const fy = c.floorY(b.pos[0], b.pos[2]);
      const fn = c.floorNormal(b.pos[0], b.pos[2]);
      const dist = (b.pos[1] - fy) * fn[1];
      if (dist < BALL_R) {
        const imp = resolve(b.pos, b.vel, fn, BALL_R - dist, FLOOR.restitution, FLOOR.friction);
        b.grounded = true;
        if (imp > 2.5) this.bounce(`floor${i}`, b.pos, imp, 'floor');
      }
    } else {
      // Inside the cup radius: the lip, the cup wall and the bottom.
      const rim: Vec3 = [hole.x + ux * hole.r, rimY, hole.z + uz * hole.r];
      const d = v3.sub(b.pos, rim);
      const dl = v3.len(d);
      if (dl < BALL_R && dl > 1e-6) {
        let n = v3.scale(d, 1 / dl);
        // A fast ball hops over the far lip instead of being stopped dead by it.
        const hv = Math.hypot(b.vel[0], b.vel[2]);
        if (hv > LIP_HOP_SPEED && !b.sunk && b.vel[0] * n[0] + b.vel[2] * n[2] < 0) n = v3.normalize([n[0] * 0.25, 1, n[2] * 0.25]);
        const imp = resolve(b.pos, b.vel, n, BALL_R - dl, 0.3, 0);
        if (n[1] > 0.3) b.grounded = true;
        if (imp > 1.2 && !b.sunk) this.lip(i, b.pos, imp);
      }
      if (b.pos[1] < rimY && dh > hole.r - BALL_R) {
        resolve(b.pos, b.vel, [-ux, 0, -uz], dh - (hole.r - BALL_R), 0.3, 0.1);
      }
      const bottom = rimY - hole.cupDepth;
      if (b.pos[1] - BALL_R < bottom) {
        resolve(b.pos, b.vel, [0, 1, 0], bottom - (b.pos[1] - BALL_R), 0.25, 0.3);
        b.grounded = true;
      }
      if (!b.sunk && b.pos[1] < rimY - BALL_R * 0.9) {
        b.sunk = true;
        b.vel[0] *= 0.3;
        b.vel[2] *= 0.3;
        this.events.push({ type: 'sink', ball: i, pos: [hole.x, rimY, hole.z] });
        if (this.winner === null) this.winner = b.owner;
      }
    }

    if (!b.sunk) {
      for (let pass = 0; pass < 2; pass++) {
        for (const body of c.bodies) {
          const ct = this.contact(body, b.pos, BALL_R);
          if (!ct) continue;
          const imp = resolve(b.pos, b.vel, ct.n, ct.depth, body.surf.restitution, body.surf.friction, body.velAt?.(ct.p));
          if (ct.n[1] > 0.6) b.grounded = true;
          if (imp > 1.5) this.bounce(`${body.id}${i}`, b.pos, imp, body.surf.tag);
        }
      }
      this.keepInRoom(b.pos, b.vel, BALL_R);
    }

    // Roll the ball visually by the distance travelled.
    const mv = v3.sub(b.pos, prev);
    const md = Math.hypot(mv[0], mv[2]);
    if (md > 1e-6) {
      const axis = v3.normalize([mv[2], 0, -mv[0]]);
      b.rot = quat.normalize(quat.mul(quat.axisAngle(axis, md / BALL_R), b.rot));
    }

    if ((b.pos[1] < -3 || !Number.isFinite(b.pos[0])) && b === this.balls[i]) this.respawnBall(i);
  }

  /**
   * Where would a ball struck from `start` with `vel` end up? Runs the real ball physics
   * on a scratch ball (other balls and rats ignored) without emitting events.
   */
  predictBall(owner: number, start: Vec3, vel: Vec3, seconds = 4, h = 1 / 60): { pos: Vec3; sunk: boolean; t: number } {
    const saved = { events: this.events, cd: this.bounceCooldown, winner: this.winner, time: this.time };
    this.events = [];
    this.bounceCooldown = new Map();
    const b: Ball = { owner, pos: v3.copy(start), vel: v3.copy(vel), rot: quat.identity(), grounded: true, sunk: false, sinceHit: 0 };
    let t = 0;
    for (; t < seconds; t += h) {
      this.course.setTime(saved.time + t);
      this.stepBall(owner, h, b);
      if (b.sunk) break;
      if (t > 0.3 && b.grounded && Math.hypot(b.vel[0], b.vel[2]) < 0.05) break;
    }
    this.events = saved.events;
    this.bounceCooldown = saved.cd;
    this.winner = saved.winner;
    this.course.setTime(saved.time);
    return { pos: b.pos, sunk: b.sunk, t };
  }

  respawnBall(i: number): void {
    const b = this.balls[i];
    b.pos = v3.copy(this.course.tees[i]);
    b.vel = [0, 0, 0];
    b.sunk = false;
    this.events.push({ type: 'respawn', ball: i });
  }

  private ballVsBall(): void {
    const [a, b] = this.balls;
    if (a.sunk || b.sunk) return;
    const d = v3.sub(b.pos, a.pos);
    const dist = v3.len(d);
    if (dist >= BALL_R * 2 || dist < 1e-6) return;
    const n = v3.scale(d, 1 / dist);
    const push = (BALL_R * 2 - dist) / 2;
    a.pos = v3.addScaled(a.pos, n, -push);
    b.pos = v3.addScaled(b.pos, n, push);
    const rel = v3.dot(v3.sub(b.vel, a.vel), n);
    if (rel < 0) {
      const j = (-(1 + 0.9) * rel) / 2;
      a.vel = v3.addScaled(a.vel, n, -j);
      b.vel = v3.addScaled(b.vel, n, j);
      if (-rel > 1) this.events.push({ type: 'clack', pos: v3.lerp(a.pos, b.pos, 0.5), speed: -rel });
    }
  }

  private ratVsBall(r: Rat, i: number): void {
    const b = this.balls[i];
    if (b.sunk) return;
    const s = this.snoutOf(r);
    const ds = v3.dist(s, b.pos);
    if (r.lungeT > 0 && !r.struck[i] && ds < SNOUT_R + BALL_R + 0.08) {
      const f = forwardOf(r.yaw);
      const away = v3.sub(b.pos, s);
      away[1] = 0;
      const aw = v3.normalize(away);
      const dir = v3.normalize([f[0] * 0.8 + aw[0] * 0.2, 0, f[2] * 0.8 + aw[2] * 0.2]);
      const pw = hitPower(r.lungeCharge);
      b.vel = [dir[0] * pw, 0.4 + r.lungeCharge * 1.2, dir[2] * pw];
      b.sinceHit = 0;
      b.pos = v3.addScaled(s, dir, SNOUT_R + BALL_R + 0.09);
      b.pos[1] = Math.max(b.pos[1], s[1]);
      r.struck[i] = true;
      if (b.owner === r.id) r.strokes++;
      r.lungeT = 0;
      r.cooldown = COOLDOWN;
      r.vel = v3.scale(r.vel, 0.15);
      this.events.push({ type: 'hit', player: r.id, ball: i, pos: v3.copy(b.pos), power: r.lungeCharge });
      return;
    }
    // Plain contact just nudges the ball.
    for (const [c, rad] of [[r.pos, RAT_R], [s, SNOUT_R]] as const) {
      const d = v3.sub(b.pos, c);
      const dist = v3.len(d);
      const min = rad + BALL_R;
      if (dist >= min || dist < 1e-6) continue;
      const n = v3.scale(d, 1 / dist);
      b.pos = v3.addScaled(b.pos, n, min - dist);
      const push = Math.min(2.5, Math.max(0, v3.dot(r.vel, n)));
      const vn = v3.dot(b.vel, n);
      if (vn < push) b.vel = v3.addScaled(b.vel, n, push - vn + 0.2);
    }
  }

  // ---------------------------------------------------------------- helpers

  private contact(b: Body, p: Vec3, r: number) {
    const bs = boundingSphere(b.shape);
    if (v3.dist(bs.c, p) > bs.r + r) return null;
    return sphereContact(b.shape, p, r);
  }

  private keepInRoom(p: Vec3, v: Vec3, r: number): void {
    const lo = [ROOM.minX + r, ROOM.minZ + r];
    const hi = [ROOM.maxX - r, ROOM.maxZ - r];
    if (p[0] < lo[0]) { p[0] = lo[0]; v[0] = Math.abs(v[0]) * 0.5; }
    if (p[0] > hi[0]) { p[0] = hi[0]; v[0] = -Math.abs(v[0]) * 0.5; }
    if (p[2] < lo[1]) { p[2] = lo[1]; v[2] = Math.abs(v[2]) * 0.5; }
    if (p[2] > hi[1]) { p[2] = hi[1]; v[2] = -Math.abs(v[2]) * 0.5; }
  }

  private bounce(key: string, pos: Vec3, speed: number, tag: string): void {
    if (this.bounceCooldown.has(key)) return;
    this.bounceCooldown.set(key, 0.08);
    this.events.push({ type: 'bounce', pos: v3.copy(pos), speed, tag });
  }

  private lip(i: number, pos: Vec3, speed: number): void {
    const key = `lip${i}`;
    if (this.bounceCooldown.has(key)) return;
    this.bounceCooldown.set(key, 0.15);
    this.events.push({ type: 'lip', pos: v3.copy(pos), speed });
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
