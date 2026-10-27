import { damp, forwardOf, lerp, mat4, v3, type Mat4, type Vec3 } from '../math';
import { boundingSphere, sphereContact } from '../physics/shapes';
import { ROOM } from './course';
import type { Rat, World } from './world';

export type CamMode = 'chase' | 'intro' | 'orbit' | 'title';

export interface CamMatrices {
  viewProj: Mat4;
  view: Mat4;
  pos: Vec3;
  right: Vec3;
  up: Vec3;
}

/** Third-person camera that trails one rat and avoids clipping into props. */
export class ChaseCam {
  pos: Vec3 = [0, 3, 0];
  target: Vec3 = [0, 0, 0];
  yaw = 0;
  shake = 0;
  private aim = 0;
  private fovY = 1;

  constructor(private world: World) {}

  snapTo(r: Rat): void {
    this.yaw = r.yaw;
    const { pos, target } = this.chasePose(r);
    this.pos = pos;
    this.target = target;
  }

  private chasePose(r: Rat): { pos: Vec3; target: Vec3 } {
    const f = forwardOf(this.yaw);
    const dist = lerp(4.9, 3.6, this.aim);
    const height = lerp(2.5, 2.3, this.aim);
    const pivot: Vec3 = [r.pos[0], r.pos[1] + 0.9, r.pos[2]];
    let want: Vec3 = [r.pos[0] - f[0] * dist, r.pos[1] + height, r.pos[2] - f[2] * dist];
    want = this.avoid(pivot, want);
    const ahead = lerp(2.4, 3.6, this.aim);
    const target: Vec3 = [r.pos[0] + f[0] * ahead, r.pos[1] + lerp(0.3, 0.05, this.aim), r.pos[2] + f[2] * ahead];
    return { pos: want, target };
  }

  /** Pull the camera in front of anything between the rat and the camera. */
  private avoid(from: Vec3, to: Vec3): Vec3 {
    const steps = 24;
    const rad = 0.3;
    let last = from;
    for (let i = 1; i <= steps; i++) {
      const p = v3.lerp(from, to, i / steps);
      let hit = false;
      for (const b of this.world.course.bodies) {
        const bs = boundingSphere(b.shape);
        if (v3.dist(bs.c, p) > bs.r + rad) continue;
        if (b.id.startsWith('spoon')) continue;
        if (sphereContact(b.shape, p, rad)) {
          hit = true;
          break;
        }
      }
      if (hit) return [last[0], Math.max(last[1], from[1]), last[2]];
      last = p;
    }
    return [
      Math.min(ROOM.maxX - 0.4, Math.max(ROOM.minX + 0.4, to[0])),
      Math.max(0.5, to[1]),
      Math.min(ROOM.maxZ - 0.4, Math.max(ROOM.minZ + 0.4, to[2])),
    ];
  }

  update(dt: number, r: Rat, mode: CamMode, t: number): void {
    const w = this.world;
    const hole = w.course.hole;
    if (r.stun <= 0) {
      const dy = Math.atan2(Math.sin(r.yaw - this.yaw), Math.cos(r.yaw - this.yaw));
      this.yaw += dy * damp(r.charging ? 9 : 4.5, dt);
    }
    this.aim += ((r.charging ? 1 : 0) - this.aim) * damp(5, dt);

    let pos: Vec3, target: Vec3;
    if (mode === 'orbit') {
      const a = t * 0.45;
      pos = [hole.x + Math.cos(a) * 5.2, 2.6, hole.z + Math.sin(a) * 5.2];
      pos = [Math.min(ROOM.maxX - 0.4, pos[0]), pos[1], Math.max(ROOM.minZ + 0.4, Math.min(ROOM.maxZ - 0.4, pos[2]))];
      target = [hole.x, 0, hole.z];
      this.pos = v3.lerp(this.pos, pos, damp(3, dt));
      this.target = v3.lerp(this.target, target, damp(4, dt));
    } else if (mode === 'title') {
      const a = t * 0.12;
      this.pos = [Math.cos(a) * 15, 7 + Math.sin(t * 0.3), Math.sin(a) * 9];
      this.target = [0, 0, 0];
    } else {
      const chase = this.chasePose(r);
      if (mode === 'intro') {
        // Swoop from above the hole down behind the rat.
        const k = Math.min(1, Math.max(0, t));
        const e = k * k * (3 - 2 * k);
        const high: Vec3 = [hole.x - 3, 9, hole.z + (r.id === 0 ? -4 : 4)];
        const holeT: Vec3 = [hole.x, 0, hole.z];
        pos = v3.lerp(high, chase.pos, e);
        target = v3.lerp(holeT, chase.target, e);
        this.pos = pos;
        this.target = target;
      } else {
        this.pos = v3.lerp(this.pos, chase.pos, damp(9, dt));
        this.target = v3.lerp(this.target, chase.target, damp(12, dt));
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  matrices(aspect: number, time: number): CamMatrices {
    const hfov = (80 * Math.PI) / 180;
    let fov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    fov = Math.min((76 * Math.PI) / 180, Math.max((48 * Math.PI) / 180, fov));
    this.fovY = fov;
    const s = this.shake * this.shake * 0.25;
    const jitter: Vec3 = [Math.sin(time * 71) * s, Math.sin(time * 53 + 1) * s, Math.cos(time * 67) * s];
    const pos = v3.add(this.pos, jitter);
    const view = mat4.lookAt(pos, this.target, [0, 1, 0]);
    const proj = mat4.perspective(fov, aspect, 0.08, 120);
    return {
      view,
      viewProj: mat4.multiply(proj, view),
      pos,
      right: [view[0], view[4], view[8]],
      up: [view[1], view[5], view[9]],
    };
  }

  get fov(): number {
    return this.fovY;
  }
}
