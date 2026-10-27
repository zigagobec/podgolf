import { m3, v3, type Mat3, type Vec3 } from '../math';

export type Shape =
  /** Oriented box: centre, rotation (columns = local axes), half extents. */
  | { kind: 'box'; c: Vec3; rot: Mat3; h: Vec3 }
  /** Upright cylinder: centre, radius, half height. */
  | { kind: 'cyl'; c: Vec3; r: number; hh: number }
  /** Capsule between a and b (a == b gives a sphere). */
  | { kind: 'capsule'; a: Vec3; b: Vec3; r: number };

export interface Contact {
  /** Unit normal pointing from the shape towards the sphere. */
  n: Vec3;
  depth: number;
  /** Closest point on the shape surface. */
  p: Vec3;
}

/** Penetration of a sphere into a shape, or null when they don't touch. */
export function sphereContact(s: Shape, p: Vec3, r: number): Contact | null {
  switch (s.kind) {
    case 'box':
      return sphereBox(s.c, s.rot, s.h, p, r);
    case 'cyl':
      return sphereCyl(s.c, s.r, s.hh, p, r);
    case 'capsule':
      return sphereCapsule(s.a, s.b, s.r, p, r);
  }
}

function sphereBox(c: Vec3, rot: Mat3, h: Vec3, p: Vec3, r: number): Contact | null {
  const l = m3.applyT(rot, v3.sub(p, c));
  if (Math.abs(l[0]) > h[0] + r || Math.abs(l[1]) > h[1] + r || Math.abs(l[2]) > h[2] + r) return null;
  const q: Vec3 = [
    Math.max(-h[0], Math.min(h[0], l[0])),
    Math.max(-h[1], Math.min(h[1], l[1])),
    Math.max(-h[2], Math.min(h[2], l[2])),
  ];
  const d = v3.sub(l, q);
  const dist = v3.len(d);
  if (dist > 1e-6) {
    if (dist >= r) return null;
    const nl = v3.scale(d, 1 / dist);
    return { n: m3.apply(rot, nl), depth: r - dist, p: v3.add(c, m3.apply(rot, q)) };
  }
  // Centre inside the box: leave through the nearest face.
  let axis = 0;
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const gap = h[i] - Math.abs(l[i]);
    if (gap < best) {
      best = gap;
      axis = i;
    }
  }
  const nl: Vec3 = [0, 0, 0];
  nl[axis] = l[axis] >= 0 ? 1 : -1;
  const qf = v3.copy(l);
  qf[axis] = nl[axis] * h[axis];
  return { n: m3.apply(rot, nl), depth: best + r, p: v3.add(c, m3.apply(rot, qf)) };
}

function sphereCyl(c: Vec3, R: number, hh: number, p: Vec3, r: number): Contact | null {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const dz = p[2] - c[2];
  if (Math.abs(dy) > hh + r) return null;
  const dh = Math.hypot(dx, dz);
  if (dh > R + r) return null;
  const ux = dh > 1e-6 ? dx / dh : 1;
  const uz = dh > 1e-6 ? dz / dh : 0;
  if (Math.abs(dy) <= hh && dh <= R) {
    const side = R - dh;
    const cap = hh - Math.abs(dy);
    if (side < cap) return { n: [ux, 0, uz], depth: side + r, p: [c[0] + ux * R, p[1], c[2] + uz * R] };
    const sy = dy >= 0 ? 1 : -1;
    return { n: [0, sy, 0], depth: cap + r, p: [p[0], c[1] + sy * hh, p[2]] };
  }
  const qr = Math.min(dh, R);
  const q: Vec3 = [c[0] + ux * qr, c[1] + Math.max(-hh, Math.min(hh, dy)), c[2] + uz * qr];
  const d = v3.sub(p, q);
  const dist = v3.len(d);
  if (dist >= r || dist < 1e-9) return null;
  return { n: v3.scale(d, 1 / dist), depth: r - dist, p: q };
}

function sphereCapsule(a: Vec3, b: Vec3, R: number, p: Vec3, r: number): Contact | null {
  const q = closestOnSegment(a, b, p);
  const d = v3.sub(p, q);
  const dist = v3.len(d);
  if (dist >= R + r) return null;
  const n: Vec3 = dist > 1e-6 ? v3.scale(d, 1 / dist) : [0, 1, 0];
  return { n, depth: R + r - dist, p: v3.addScaled(q, n, R) };
}

export function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = v3.sub(b, a);
  const len2 = v3.dot(ab, ab);
  if (len2 < 1e-12) return v3.copy(a);
  const t = Math.max(0, Math.min(1, v3.dot(v3.sub(p, a), ab) / len2));
  return v3.addScaled(a, ab, t);
}

/** Cheap broad-phase radius around a shape's centre. */
export function boundingSphere(s: Shape): { c: Vec3; r: number } {
  switch (s.kind) {
    case 'box':
      return { c: s.c, r: v3.len(s.h) };
    case 'cyl':
      return { c: s.c, r: Math.hypot(s.r, s.hh) };
    case 'capsule':
      return { c: v3.lerp(s.a, s.b, 0.5), r: v3.dist(s.a, s.b) / 2 + s.r };
  }
}
