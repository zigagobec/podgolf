import type { Vec3 } from '../math';
import { PARTICLE_FLOATS } from './renderer';

export const SHAPE = { puff: 0, disc: 1, square: 2, ring: 3, star: 4, chevron: 5, glow: 6 } as const;

interface P {
  pos: Vec3;
  vel: Vec3;
  life: number;
  max: number;
  size0: number;
  size1: number;
  color: Vec3;
  alpha: number;
  rot: number;
  spin: number;
  shape: number;
  flat: boolean;
  additive: boolean;
  gravity: number;
  drag: number;
}

export interface SpawnOpts {
  vel?: Vec3;
  life?: number;
  size?: number;
  size1?: number;
  color?: Vec3;
  alpha?: number;
  rot?: number;
  spin?: number;
  shape?: number;
  flat?: boolean;
  additive?: boolean;
  gravity?: number;
  drag?: number;
}

/** sRGB-ish colour to the linear space the scene renders in. */
export const linear = (c: Vec3): Vec3 => [c[0] * c[0], c[1] * c[1], c[2] * c[2]];

export class Particles {
  private list: P[] = [];
  private immediate: number[] = [];
  data = new Float32Array(2048 * PARTICLE_FLOATS);
  count = 0;

  spawn(pos: Vec3, o: SpawnOpts = {}): void {
    if (this.list.length > 1800) return;
    const life = o.life ?? 0.6;
    this.list.push({
      pos: [pos[0], pos[1], pos[2]],
      vel: o.vel ? [o.vel[0], o.vel[1], o.vel[2]] : [0, 0, 0],
      life,
      max: life,
      size0: o.size ?? 0.2,
      size1: o.size1 ?? o.size ?? 0.2,
      color: o.color ?? [1, 1, 1],
      alpha: o.alpha ?? 1,
      rot: o.rot ?? Math.random() * Math.PI * 2,
      spin: o.spin ?? 0,
      shape: o.shape ?? SHAPE.puff,
      flat: o.flat ?? false,
      additive: o.additive ?? false,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 1,
    });
  }

  /** A particle that lives for this frame only. */
  now(pos: Vec3, size: number, color: Vec3, alpha: number, shape: number, rot = 0, flat = false, additive = false): void {
    this.immediate.push(pos[0], pos[1], pos[2], size, color[0], color[1], color[2], alpha, rot, shape, flat ? 1 : 0, additive ? 1 : 0);
  }

  update(dt: number): void {
    const keep: P[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel[1] -= p.gravity * dt;
      const k = Math.exp(-p.drag * dt);
      p.vel[0] *= k;
      p.vel[1] *= k;
      p.vel[2] *= k;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;
      if (p.gravity > 0 && p.pos[1] < 0.02) {
        p.pos[1] = 0.02;
        p.vel[1] *= -0.3;
        p.vel[0] *= 0.6;
        p.vel[2] *= 0.6;
        p.spin *= 0.5;
      }
      p.rot += p.spin * dt;
      keep.push(p);
    }
    this.list = keep;
  }

  pack(): void {
    const n = this.list.length + this.immediate.length / PARTICLE_FLOATS;
    if (this.data.length < n * PARTICLE_FLOATS) this.data = new Float32Array(Math.ceil(n * 1.5) * PARTICLE_FLOATS);
    const d = this.data;
    let o = 0;
    for (const p of this.list) {
      const t = 1 - p.life / p.max;
      const fade = Math.min(1, p.life / (p.max * 0.35));
      d[o++] = p.pos[0];
      d[o++] = p.pos[1];
      d[o++] = p.pos[2];
      d[o++] = p.size0 + (p.size1 - p.size0) * t;
      d[o++] = p.color[0];
      d[o++] = p.color[1];
      d[o++] = p.color[2];
      d[o++] = p.alpha * fade;
      d[o++] = p.rot;
      d[o++] = p.shape;
      d[o++] = p.flat ? 1 : 0;
      d[o++] = p.additive ? 1 : 0;
    }
    d.set(this.immediate, o);
    this.count = n;
    this.immediate.length = 0;
  }

  clear(): void {
    this.list = [];
    this.immediate.length = 0;
  }
}
