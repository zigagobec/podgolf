import type { Course, MeshName } from '../game/course';

/** Interleaved position + normal (6 floats per vertex). */
export interface MeshData {
  v: number[];
  i: number[];
}

export type AnyMesh = MeshName | 'floor' | 'cupWall';

function push(m: MeshData, p: number[], n: number[]) {
  m.v.push(p[0], p[1], p[2], n[0], n[1], n[2]);
  return m.v.length / 6 - 1;
}

/** Unit cube [-0.5, 0.5]^3 with flat faces. */
export function boxMesh(): MeshData {
  const m: MeshData = { v: [], i: [] };
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, w] of faces) {
    const base = m.v.length / 6;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      push(m, [n[0] * 0.5 + u[0] * a * 0.5 + w[0] * b * 0.5, n[1] * 0.5 + u[1] * a * 0.5 + w[1] * b * 0.5, n[2] * 0.5 + u[2] * a * 0.5 + w[2] * b * 0.5], n);
    }
    m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return m;
}

/** Unit-diameter UV sphere. */
export function sphereMesh(lat = 18, lon = 28): MeshData {
  const m: MeshData = { v: [], i: [] };
  for (let y = 0; y <= lat; y++) {
    const th = (y / lat) * Math.PI;
    for (let x = 0; x <= lon; x++) {
      const ph = (x / lon) * Math.PI * 2;
      const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
      push(m, [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], n);
    }
  }
  for (let y = 0; y < lat; y++)
    for (let x = 0; x < lon; x++) {
      const a = y * (lon + 1) + x;
      const b = a + lon + 1;
      m.i.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return m;
}

/** Cylinder of diameter 1 and height 1 (y from -0.5 to 0.5) with caps. */
export function cylMesh(seg = 32): MeshData {
  const m: MeshData = { v: [], i: [] };
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const n = [Math.sin(a), 0, Math.cos(a)];
    push(m, [n[0] * 0.5, -0.5, n[2] * 0.5], n);
    push(m, [n[0] * 0.5, 0.5, n[2] * 0.5], n);
  }
  for (let s = 0; s < seg; s++) {
    const a = s * 2;
    m.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  for (const y of [-0.5, 0.5]) {
    const n = [0, Math.sign(y), 0];
    const c = push(m, [0, y, 0], n);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      push(m, [Math.sin(a) * 0.5, y, Math.cos(a) * 0.5], n);
    }
    for (let s = 0; s < seg; s++) {
      if (y > 0) m.i.push(c, c + 1 + s, c + 2 + s);
      else m.i.push(c, c + 2 + s, c + 1 + s);
    }
  }
  return m;
}

/** Cone with base diameter 1 at y = -0.5 and tip at y = 0.5. */
export function coneMesh(seg = 24): MeshData {
  const m: MeshData = { v: [], i: [] };
  const k = 0.5 / Math.hypot(0.5, 1);
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const n = [Math.sin(a) * (1 - k * k) ** 0.5, k * 2 * 0.5, Math.cos(a) * (1 - k * k) ** 0.5];
    push(m, [Math.sin(a) * 0.5, -0.5, Math.cos(a) * 0.5], n);
    push(m, [0, 0.5, 0], n);
  }
  for (let s = 0; s < seg; s++) m.i.push(s * 2, s * 2 + 2, s * 2 + 1);
  const c = push(m, [0, -0.5, 0], [0, -1, 0]);
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    push(m, [Math.sin(a) * 0.5, -0.5, Math.cos(a) * 0.5], [0, -1, 0]);
  }
  for (let s = 0; s < seg; s++) m.i.push(c, c + 2 + s, c + 1 + s);
  return m;
}

/** Torus in the xz plane, major radius 0.5, minor radius `minor`. */
export function torusMesh(minor = 0.12, seg = 32, side = 10): MeshData {
  const m: MeshData = { v: [], i: [] };
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const ca = Math.sin(a), sa = Math.cos(a);
    for (let t = 0; t <= side; t++) {
      const b = (t / side) * Math.PI * 2;
      const n = [ca * Math.cos(b), Math.sin(b), sa * Math.cos(b)];
      push(m, [ca * (0.5 + minor * Math.cos(b)), minor * Math.sin(b), sa * (0.5 + minor * Math.cos(b))], n);
    }
  }
  for (let s = 0; s < seg; s++)
    for (let t = 0; t < side; t++) {
      const a = s * (side + 1) + t;
      const b = a + side + 1;
      m.i.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return m;
}

/** Open tube of radius 1 from y = 0 down to y = -1 with inward normals (the cup). */
export function cupWallMesh(seg = 48): MeshData {
  const m: MeshData = { v: [], i: [] };
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const n = [-Math.sin(a), 0, -Math.cos(a)];
    push(m, [Math.sin(a), 0, Math.cos(a)], n);
    push(m, [Math.sin(a), -1, Math.cos(a)], n);
  }
  for (let s = 0; s < seg; s++) {
    const a = s * 2;
    m.i.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  return m;
}

/** Kitchen floor in world space: flat grid plus a polar ring around the drain funnel and its cup. */
export function floorMesh(course: Course): MeshData {
  const m: MeshData = { v: [], i: [] };
  const h = course.hole;
  const half = 3;
  const step = 0.5;
  const x0 = -24, x1 = 24, z0 = -16, z1 = 16;
  const nx = Math.round((x1 - x0) / step);
  const nz = Math.round((z1 - z0) / step);
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      idx.push(push(m, [x, course.floorY(x, z), z], course.floorNormal(x, z)));
    }
  const inSquare = (x: number, z: number) => x > h.x - half - 1e-6 && x < h.x + half + 1e-6 && z > h.z - half - 1e-6 && z < h.z + half + 1e-6;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
      if (inSquare(cx, cz)) continue;
      const a = idx[j * (nx + 1) + i];
      const b = idx[j * (nx + 1) + i + 1];
      const c = idx[(j + 1) * (nx + 1) + i];
      const d = idx[(j + 1) * (nx + 1) + i + 1];
      m.i.push(a, c, b, b, c, d);
    }
  // Perimeter of the square, counter-clockwise seen from above, every 0.25.
  const per: [number, number][] = [];
  const n = (half * 2) / 0.25;
  for (let k = 0; k < n; k++) per.push([h.x - half + k * 0.25, h.z - half]);
  for (let k = 0; k < n; k++) per.push([h.x + half, h.z - half + k * 0.25]);
  for (let k = 0; k < n; k++) per.push([h.x + half - k * 0.25, h.z + half]);
  for (let k = 0; k < n; k++) per.push([h.x - half, h.z + half - k * 0.25]);
  const rings = 16;
  const ringIdx: number[][] = [];
  for (const [px, pz] of per) {
    const ang = Math.atan2(px - h.x, pz - h.z);
    const ix = h.x + Math.sin(ang) * h.r;
    const iz = h.z + Math.cos(ang) * h.r;
    const col: number[] = [];
    for (let r = 0; r <= rings; r++) {
      // Denser rings near the cup.
      const t = (r / rings) ** 1.6;
      const x = ix + (px - ix) * t;
      const z = iz + (pz - iz) * t;
      col.push(push(m, [x, course.floorY(x, z), z], course.floorNormal(x, z)));
    }
    ringIdx.push(col);
  }
  for (let k = 0; k < ringIdx.length; k++) {
    const A = ringIdx[k];
    const B = ringIdx[(k + 1) % ringIdx.length];
    for (let r = 0; r < rings; r++) m.i.push(A[r], B[r], A[r + 1], B[r], B[r + 1], A[r + 1]);
  }
  return m;
}

export function buildMeshes(course: Course): Record<AnyMesh, MeshData> {
  return {
    box: boxMesh(),
    sphere: sphereMesh(),
    cyl: cylMesh(),
    cone: coneMesh(),
    torus: torusMesh(),
    floor: floorMesh(course),
    cupWall: cupWallMesh(),
  };
}
