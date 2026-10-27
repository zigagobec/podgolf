import { MAT, type Look } from '../materials';
import { forwardOf, m3, v3, type Mat3, type Vec3 } from '../math';
import type { Shape } from '../physics/shapes';

export interface Surface {
  restitution: number;
  friction: number;
  /** Tag used for sound / particle choice. */
  tag: 'wall' | 'can' | 'wood' | 'cheese' | 'sponge' | 'bread' | 'cardboard' | 'spoon' | 'glass';
}

export interface Body {
  id: string;
  shape: Shape;
  surf: Surface;
  look?: Look;
  /** Moving collider: velocity of its surface at a world point. */
  velAt?: (p: Vec3) => Vec3;
}

export type MeshName = 'box' | 'sphere' | 'cyl' | 'cone' | 'torus';

/** Purely decorative piece. */
export interface Prop {
  mesh: MeshName;
  t: Vec3;
  rot: Mat3;
  s: Vec3;
  look: Look;
  noShadow?: boolean;
}

export interface Hole {
  x: number;
  z: number;
  /** Cup radius. */
  r: number;
  /** Radius of the shallow drain funnel around the cup. */
  funnelR: number;
  funnelDepth: number;
  cupDepth: number;
}

/** Patch of spilled milk that slows rolling balls. */
export interface StickyZone {
  x: number;
  z: number;
  r: number;
}

export const ROOM = { minX: -20, maxX: 20, minZ: -13, maxZ: 13 };

const S = {
  wall: { restitution: 0.55, friction: 0.1, tag: 'wall' } as Surface,
  can: { restitution: 0.6, friction: 0.05, tag: 'can' } as Surface,
  wood: { restitution: 0.45, friction: 0.1, tag: 'wood' } as Surface,
  cheese: { restitution: 0.3, friction: 0.05, tag: 'cheese' } as Surface,
  sponge: { restitution: 1.25, friction: 0.0, tag: 'sponge' } as Surface,
  bread: { restitution: 0.35, friction: 0.2, tag: 'bread' } as Surface,
  card: { restitution: 0.4, friction: 0.1, tag: 'cardboard' } as Surface,
  spoon: { restitution: 0.7, friction: 0.05, tag: 'spoon' } as Surface,
  glass: { restitution: 0.65, friction: 0.05, tag: 'glass' } as Surface,
};

const I = m3.identity();

function box(id: string, c: Vec3, h: Vec3, surf: Surface, look: Look, yaw = 0, roll = 0): Body {
  return { id, shape: { kind: 'box', c, rot: m3.fromEuler(yaw, 0, roll), h }, surf, look };
}

function cyl(id: string, x: number, z: number, r: number, height: number, surf: Surface, look: Look): Body {
  return { id, shape: { kind: 'cyl', c: [x, height / 2, z], r, hh: height / 2 }, surf, look };
}

/**
 * Slab whose top face runs from (x0, y0) to (x1, y1) along x (centred on z, half width hz).
 * Sunk partly below the floor it reads as a wedge ramp.
 */
function rampX(id: string, x0: number, y0: number, x1: number, y1: number, z: number, hz: number, look: Look): Body {
  if (x1 < x0) [x0, y0, x1, y1] = [x1, y1, x0, y0];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const thick = 0.35;
  const rot = m3.fromEuler(0, 0, ang);
  const up = m3.apply(rot, [0, 1, 0]);
  const mid: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, z];
  const c = v3.addScaled(mid, up, -thick);
  return { id, shape: { kind: 'box', c, rot, h: [len / 2 + 0.12, thick, hz] }, surf: S.cheese, look };
}

export class Course {
  readonly bodies: Body[] = [];
  readonly props: Prop[] = [];
  readonly hole: Hole = { x: 15.5, z: 2.5, r: 0.55, funnelR: 2.4, funnelDepth: 0.32, cupDepth: 0.95 };
  readonly sticky: StickyZone[] = [{ x: 11.5, z: 9, r: 2.3 }];
  readonly tees: Vec3[] = [
    [-15.5, 0.25, -2],
    [-15.5, 0.25, 2],
  ];
  readonly ratStarts: { pos: Vec3; yaw: number }[] = [
    { pos: [-17.6, 0.4, -2], yaw: Math.PI / 2 },
    { pos: [-17.6, 0.4, 2], yaw: Math.PI / 2 },
  ];
  /** Rotating wooden spoon guarding the approach. */
  readonly spoon = { pivot: [10, 0.32, 0.6] as Vec3, len: 3.1, bowlR: 0.5, handleR: 0.17, speed: 1.05, angle: 0 };
  private spoonHandle: Body;
  private spoonBowl: Body;

  constructor() {
    const B = this.bodies;
    const { minX, maxX, minZ, maxZ } = ROOM;
    // Room walls (thick so nothing tunnels through).
    B.push(box('wall-n', [0, 2.5, minZ - 1], [maxX + 2, 2.5, 1], S.wall, { mat: MAT.cabinet, color: [0.2, 0.36, 0.38] }));
    B.push(box('wall-s', [0, 3, maxZ + 1], [maxX + 2, 3, 1], S.wall, { mat: MAT.wall, color: [0.62, 0.5, 0.38] }));
    B.push(box('wall-w', [minX - 1, 3, 0], [1, 3, maxZ + 2], S.wall, { mat: MAT.wall, color: [0.62, 0.5, 0.38] }));
    B.push(box('fridge', [maxX + 1.2, 5, 0], [1.2, 5, 5.5], S.wall, { mat: MAT.fridge, color: [0.86, 0.88, 0.84] }));
    B.push(box('wall-e1', [maxX + 1, 2.5, -9.5], [1, 2.5, 4], S.wall, { mat: MAT.cabinet, color: [0.2, 0.36, 0.38] }));
    B.push(box('wall-e2', [maxX + 1, 2.5, 9.5], [1, 2.5, 4], S.wall, { mat: MAT.cabinet, color: [0.2, 0.36, 0.38] }));

    // A fallen baguette splits the middle of the kitchen.
    B.push({ id: 'baguette', shape: { kind: 'capsule', a: [-8, 0.5, 0], b: [4, 0.5, 0.4], r: 0.5 }, surf: S.bread, look: { mat: MAT.bread, color: [0.86, 0.6, 0.3] } });

    // North half: a forest of food cans.
    const canColors: [number, number, number][] = [
      [0.85, 0.2, 0.15], [0.25, 0.6, 0.3], [0.95, 0.75, 0.2], [0.3, 0.45, 0.85], [0.9, 0.45, 0.15],
    ];
    const cans: [number, number, number][] = [
      [-5, -4.5, 0.55], [-2.4, -8.6, 0.6], [-1, -3.2, 0.5], [1.6, -6.6, 0.6], [3.8, -10, 0.55],
      [4.2, -3.3, 0.5], [-4.6, -10.4, 0.5], [-7.2, -7.2, 0.6], [7, -8.2, 0.55], [-11, -6, 0.5],
    ];
    cans.forEach(([x, z, r], i) =>
      B.push(cyl(`can${i}`, x, z, r, 1.3 + (i % 3) * 0.25, S.can, { mat: MAT.can, color: canColors[i % canColors.length], param: i })),
    );

    // South half: a cutting board plateau with cheese ramps on both ends.
    B.push(box('board', [-1, 0.25, 7], [3, 0.25, 2.2], S.wood, { mat: MAT.wood, color: [0.72, 0.5, 0.3] }));
    B.push(rampX('ramp-w', -7, 0, -4, 0.5, 7, 1.7, { mat: MAT.cheese, color: [1, 0.78, 0.25] }));
    B.push(rampX('ramp-e', 5, 0, 2, 0.5, 7, 1.7, { mat: MAT.cheese, color: [1, 0.78, 0.25] }));
    // Bouncy sponges.
    B.push(box('sponge0', [-10.5, 0.4, 9.5], [1.4, 0.4, 0.5], S.sponge, { mat: MAT.sponge, color: [0.45, 0.85, 0.35] }, 0.5));
    B.push(box('sponge1', [6, 0.4, 11.4], [1.4, 0.4, 0.5], S.sponge, { mat: MAT.sponge, color: [0.98, 0.85, 0.3] }, -0.15));
    B.push(box('sponge2', [8.4, 0.4, 4.6], [1.3, 0.4, 0.5], S.sponge, { mat: MAT.sponge, color: [0.45, 0.85, 0.35] }, -0.45));
    B.push(box('sponge3', [-12.5, 0.4, -10.6], [1.4, 0.4, 0.5], S.sponge, { mat: MAT.sponge, color: [0.98, 0.85, 0.3] }, 0.7));

    // Cereal-box tunnel on the north approach.
    const card = { mat: MAT.cardboard, color: [0.95, 0.55, 0.2] as [number, number, number] };
    B.push(box('tunnel-n', [10.5, 0.95, -7.2], [2.3, 0.95, 0.18], S.card, card));
    B.push(box('tunnel-s', [10.5, 0.95, -3.9], [2.3, 0.95, 0.18], S.card, card));
    B.push(box('tunnel-roof', [10.5, 2.05, -5.55], [2.3, 0.15, 1.83], S.card, card));

    // Salt and pepper shakers near the hole.
    B.push(cyl('salt', 13, 6.2, 0.4, 1.6, S.glass, { mat: MAT.metal, color: [0.92, 0.92, 0.95] }));
    B.push(cyl('pepper', 18, -1.4, 0.4, 1.6, S.glass, { mat: MAT.metal, color: [0.25, 0.22, 0.22] }));
    // Sugar cubes.
    const cubes: [number, number, number][] = [[-12, 4.5, 0.3], [-8.5, -2.5, 0.8], [7.5, 0.5, 0.2], [14, -4.5, 0.6], [-3, 11, 1.1], [16.8, 6.5, 0.4]];
    cubes.forEach(([x, z, yaw], i) =>
      B.push(box(`sugar${i}`, [x, 0.3, z], [0.3, 0.3, 0.3], S.wood, { mat: MAT.plain, color: [0.97, 0.96, 0.92] }, yaw)),
    );

    // Spinning spoon on a cork hub.
    B.push(cyl('cork', this.spoon.pivot[0], this.spoon.pivot[2], 0.32, 0.75, S.wood, { mat: MAT.wood, color: [0.78, 0.58, 0.36], param: 1 }));
    this.spoonHandle = { id: 'spoon-handle', shape: { kind: 'capsule', a: [0, 0, 0], b: [0, 0, 0], r: this.spoon.handleR }, surf: S.spoon, velAt: (p) => this.spoonVel(p) };
    this.spoonBowl = { id: 'spoon-bowl', shape: { kind: 'capsule', a: [0, 0, 0], b: [0, 0, 0], r: this.spoon.bowlR }, surf: S.spoon, velAt: (p) => this.spoonVel(p) };
    B.push(this.spoonHandle, this.spoonBowl);
    this.setTime(0);

    this.addDecor();
  }

  /** Advance moving parts to absolute time t (seconds). */
  setTime(t: number): void {
    const sp = this.spoon;
    sp.angle = 0.6 + t * sp.speed;
    const f = forwardOf(sp.angle);
    const p = sp.pivot;
    const h = this.spoonHandle.shape as { a: Vec3; b: Vec3 };
    h.a = v3.addScaled(p, f, 0.3);
    h.b = v3.addScaled(p, f, sp.len - 0.3);
    const bowl = v3.addScaled(p, f, sp.len + 0.35);
    const b = this.spoonBowl.shape as { a: Vec3; b: Vec3 };
    const side: Vec3 = [f[2], 0, -f[0]];
    b.a = v3.addScaled(bowl, side, -0.12);
    b.b = v3.addScaled(bowl, side, 0.12);
  }

  private spoonVel(p: Vec3): Vec3 {
    const w = this.spoon.speed;
    const rx = p[0] - this.spoon.pivot[0];
    const rz = p[2] - this.spoon.pivot[2];
    return [w * rz, 0, -w * rx];
  }

  /** Floor height under (x, z); the drain funnel dips toward the hole. */
  floorY(x: number, z: number): number {
    const h = this.hole;
    const d = Math.hypot(x - h.x, z - h.z);
    if (d >= h.funnelR) return 0;
    const t = 1 - d / h.funnelR;
    return -h.funnelDepth * t * t;
  }

  /** Floor normal under (x, z). */
  floorNormal(x: number, z: number): Vec3 {
    const h = this.hole;
    const dx = x - h.x;
    const dz = z - h.z;
    const d = Math.hypot(dx, dz);
    if (d >= h.funnelR || d < 1e-6) return [0, 1, 0];
    const t = 1 - d / h.funnelR;
    // dy/dd = 2 * depth * t / funnelR (rising outward)
    const slope = (2 * h.funnelDepth * t) / h.funnelR;
    return v3.normalize([-slope * (dx / d), 1, -slope * (dz / d)]);
  }

  rimY(): number {
    return this.floorY(this.hole.x + this.hole.r, this.hole.z);
  }

  stickyAt(x: number, z: number): boolean {
    return this.sticky.some((s) => Math.hypot(x - s.x, z - s.z) < s.r);
  }

  private addDecor(): void {
    const P = this.props;
    const { minZ, maxZ, maxX, minX } = ROOM;
    const handle = { mat: MAT.metal, color: [0.75, 0.75, 0.78] as [number, number, number] };
    // Cabinet door handles and toe-kick shadow line on the north wall.
    for (let x = -18; x <= 18; x += 6) {
      P.push({ mesh: 'box', t: [x + 2.6, 3.6, minZ - 0.05], rot: I, s: [1.4, 0.18, 0.18], look: handle });
      P.push({ mesh: 'box', t: [x, 2.6, minZ + 0.02], rot: I, s: [0.08, 4.0, 0.05], look: { mat: MAT.plain, color: [0.1, 0.16, 0.17] } });
    }
    P.push({ mesh: 'box', t: [0, 0.35, minZ + 0.03], rot: I, s: [44, 0.7, 0.05], look: { mat: MAT.plain, color: [0.08, 0.1, 0.1] } });
    // Countertop lip.
    P.push({ mesh: 'box', t: [0, 5.15, minZ - 0.6], rot: I, s: [44, 0.3, 3.2], look: { mat: MAT.wood, color: [0.55, 0.38, 0.25], param: 2 } });
    // Baseboards.
    P.push({ mesh: 'box', t: [0, 0.3, maxZ + 0.02], rot: I, s: [44, 0.6, 0.08], look: { mat: MAT.plain, color: [0.9, 0.86, 0.78] } });
    P.push({ mesh: 'box', t: [minX - 0.02, 0.3, 0], rot: I, s: [0.08, 0.6, 30], look: { mat: MAT.plain, color: [0.9, 0.86, 0.78] } });
    // Upper walls so the room doesn't end in a void above the counter.
    const upper = { mat: MAT.wall, color: [0.5, 0.42, 0.34] as [number, number, number] };
    P.push({ mesh: 'box', t: [0, 10, minZ - 2.4], rot: I, s: [46, 10, 1], look: upper, noShadow: true });
    P.push({ mesh: 'box', t: [0, 10.5, maxZ + 1.5], rot: I, s: [46, 9, 1], look: upper, noShadow: true });
    P.push({ mesh: 'box', t: [minX - 1.5, 10.5, 0], rot: I, s: [1, 9, 32], look: upper, noShadow: true });
    P.push({ mesh: 'box', t: [maxX + 1.5, 12.5, 0], rot: I, s: [1, 5, 32], look: upper, noShadow: true });
    // Upper cabinets above the counter.
    P.push({ mesh: 'box', t: [0, 12.2, minZ - 1.3], rot: I, s: [44, 4.4, 1.4], look: { mat: MAT.cabinet, color: [0.2, 0.36, 0.38] }, noShadow: true });
    // Window with moonlight on the south wall.
    P.push({ mesh: 'box', t: [6, 9.5, maxZ + 0.95], rot: I, s: [7, 5, 0.1], look: { mat: MAT.glow, color: [0.32, 0.42, 0.7], param: 1.2 } });
    P.push({ mesh: 'box', t: [6, 9.5, maxZ + 0.9], rot: I, s: [0.25, 5, 0.12], look: { mat: MAT.plain, color: [0.85, 0.82, 0.75] } });
    P.push({ mesh: 'box', t: [6, 9.5, maxZ + 0.9], rot: I, s: [7, 0.25, 0.12], look: { mat: MAT.plain, color: [0.85, 0.82, 0.75] } });
    P.push({ mesh: 'sphere', t: [7.8, 10.6, maxZ + 0.92], rot: I, s: [1.3, 1.3, 0.05], look: { mat: MAT.glow, color: [1, 0.97, 0.85], param: 2 } });
    // Mouse hole in the west wall (home).
    P.push({ mesh: 'cyl', t: [minX + 0.02, 0, 0], rot: m3.fromEuler(0, 0, Math.PI / 2), s: [2.6, 0.06, 2.6], look: { mat: MAT.plain, color: [0.02, 0.015, 0.02] } });
    // Fridge handle + magnets + glow strip from the door gap.
    P.push({ mesh: 'box', t: [maxX + 0.05, 6.5, -4.6], rot: I, s: [0.25, 3, 0.25], look: handle });
    P.push({ mesh: 'box', t: [maxX - 0.02, 0.6, 0], rot: I, s: [0.04, 0.12, 10.8], look: { mat: MAT.plain, color: [0.15, 0.15, 0.16] } });
    const magnets: [number, number, [number, number, number]][] = [[2, 8, [0.95, 0.3, 0.3]], [-1.5, 7.2, [0.3, 0.7, 0.95]], [0.8, 5.6, [0.98, 0.85, 0.25]]];
    for (const [z, y, c] of magnets) P.push({ mesh: 'cyl', t: [maxX - 0.02, y, z], rot: m3.fromEuler(0, 0, Math.PI / 2), s: [0.7, 0.12, 0.7], look: { mat: MAT.plain, color: c } });
    // Wall outlet on the south wall.
    P.push({ mesh: 'box', t: [-6, 1.6, maxZ - 0.02], rot: I, s: [0.9, 1.3, 0.06], look: { mat: MAT.plain, color: [0.94, 0.92, 0.86] } });
    // Crumbs (no collision).
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const x = minX + 1 + rnd() * (maxX - minX - 2);
      const z = minZ + 1 + rnd() * (maxZ - minZ - 2);
      if (Math.hypot(x - this.hole.x, z - this.hole.z) < 3) continue;
      const s = 0.06 + rnd() * 0.1;
      P.push({ mesh: 'sphere', t: [x, s * 0.25, z], rot: m3.fromEuler(rnd() * 6), s: [s * 1.6, s, s * 1.2], look: { mat: MAT.bread, color: [0.85, 0.62, 0.32] } });
    }
    // Milk puddle.
    for (const s of this.sticky) {
      P.push({ mesh: 'cyl', t: [s.x, 0.004, s.z], rot: I, s: [s.r * 2, 0.008, s.r * 1.8], look: { mat: MAT.milk, color: [0.96, 0.95, 0.9] } });
      P.push({ mesh: 'cyl', t: [s.x + s.r * 0.7, 0.004, s.z - s.r * 0.5], rot: I, s: [s.r * 0.9, 0.008, s.r * 0.8], look: { mat: MAT.milk, color: [0.96, 0.95, 0.9] } });
    }
  }
}
