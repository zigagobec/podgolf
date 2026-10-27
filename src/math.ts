/** Small vector / matrix / quaternion helpers. Matrices are column-major for WebGPU (clip z 0..1). */
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float32Array;
/** 3x3 rotation, column-major: columns are the local x, y, z axes. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  addScaled: (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  lenXZ: (a: Vec3): number => Math.hypot(a[0], a[2]),
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  normalize: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  copy: (a: Vec3): Vec3 => [a[0], a[1], a[2]],
};

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential approach factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Unit forward vector for a yaw angle (yaw 0 faces +z). */
export const forwardOf = (yaw: number): Vec3 => [Math.sin(yaw), 0, Math.cos(yaw)];

export const m3 = {
  identity: (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  /** Rotation Y(yaw) * X(pitch) * Z(roll). */
  fromEuler(yaw: number, pitch = 0, roll = 0): Mat3 {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // Y * X
    const a: Mat3 = [cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp];
    if (!roll) return a;
    const z: Mat3 = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
    return m3.mul(a, z);
  },
  mul(a: Mat3, b: Mat3): Mat3 {
    const o = new Array(9).fill(0) as Mat3;
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    return o;
  },
  apply: (m: Mat3, v: Vec3): Vec3 => [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ],
  /** Transpose-apply (inverse for rotations). */
  applyT: (m: Mat3, v: Vec3): Vec3 => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ],
  fromQuat(q: Quat): Mat3 {
    const [x, y, z, w] = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ];
  },
  /** Rotation whose local y axis is `up` and whose local z axis is as close to `fwd` as possible. */
  basis(up: Vec3, fwd: Vec3): Mat3 {
    const y = v3.normalize(up);
    let x = v3.cross(y, fwd);
    if (v3.len(x) < 1e-6) x = [1, 0, 0];
    x = v3.normalize(x);
    const z = v3.cross(x, y);
    return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  },
};

export const quat = {
  identity: (): Quat => [0, 0, 0, 1],
  axisAngle(axis: Vec3, angle: number): Quat {
    const s = Math.sin(angle / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  },
  mul(a: Quat, b: Quat): Quat {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },
  normalize(q: Quat): Quat {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
};

export const mat4 = {
  identity(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovY / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1;
    m[14] = (near * far) / (near - far);
    return m;
  },
  ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = 1 / (n - f);
    m[12] = (l + r) / (l - r);
    m[13] = (t + b) / (b - t);
    m[14] = n / (n - f);
    m[15] = 1;
    return m;
  },
  lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    const z = v3.normalize(v3.sub(eye, target));
    const x = v3.normalize(v3.cross(up, z));
    const y = v3.cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -v3.dot(x, eye);
    m[13] = -v3.dot(y, eye);
    m[14] = -v3.dot(z, eye);
    m[15] = 1;
    return m;
  },
  multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
      }
    return out;
  },
  /** Translation * rotation * scale. */
  trs(t: Vec3, r: Mat3, s: Vec3): Mat4 {
    const m = new Float32Array(16);
    m[0] = r[0] * s[0]; m[1] = r[1] * s[0]; m[2] = r[2] * s[0];
    m[4] = r[3] * s[1]; m[5] = r[4] * s[1]; m[6] = r[5] * s[1];
    m[8] = r[6] * s[2]; m[9] = r[7] * s[2]; m[10] = r[8] * s[2];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
  },
  transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
    ];
  },
};

/** Deterministic small PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
