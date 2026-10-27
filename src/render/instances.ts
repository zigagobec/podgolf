import { m3, type Mat3, type Vec3 } from '../math';
import type { AnyMesh } from './meshes';

/** Floats per instance; must match `Inst` in common.wgsl. */
export const INST_FLOATS = 36;

export const MESH_ORDER: AnyMesh[] = ['floor', 'box', 'sphere', 'cyl', 'cone', 'torus', 'cupWall'];

export interface DrawRange {
  mesh: AnyMesh;
  first: number;
  count: number;
}

export interface InstanceOpts {
  param?: number;
  emissive?: number;
  noShadow?: boolean;
}

/** Collects per-frame instances grouped by mesh so each mesh is one instanced draw. */
export class Instances {
  private per = new Map<AnyMesh, number[]>();

  clear(): void {
    for (const a of this.per.values()) a.length = 0;
  }

  /** Replace the contents with a copy of another list. */
  copyFrom(o: Instances): void {
    this.clear();
    for (const [mesh, a] of o.per) {
      let mine = this.per.get(mesh);
      if (!mine) this.per.set(mesh, (mine = []));
      for (let i = 0; i < a.length; i++) mine.push(a[i]);
    }
  }

  add(mesh: AnyMesh, t: Vec3, rot: Mat3, s: Vec3, color: Vec3 | number[], mat: number, o: InstanceOpts = {}): void {
    let a = this.per.get(mesh);
    if (!a) this.per.set(mesh, (a = []));
    const r = rot;
    // model = T * R * S
    a.push(
      r[0] * s[0], r[1] * s[0], r[2] * s[0], 0,
      r[3] * s[1], r[4] * s[1], r[5] * s[1], 0,
      r[6] * s[2], r[7] * s[2], r[8] * s[2], 0,
      t[0], t[1], t[2], 1,
      // normal matrix = R * S^-1, each column padded to vec4
      r[0] / s[0], r[1] / s[0], r[2] / s[0], 0,
      r[3] / s[1], r[4] / s[1], r[5] / s[1], 0,
      r[6] / s[2], r[7] / s[2], r[8] / s[2], 0,
      color[0], color[1], color[2], o.emissive ?? 0,
      mat, o.param ?? 0, o.noShadow ? 1 : 0, 0,
    );
  }

  /** Pack in mesh order into `out` (grown as needed); returns the draw ranges. */
  pack(out: { data: Float32Array }): { ranges: DrawRange[]; total: number } {
    let total = 0;
    for (const a of this.per.values()) total += a.length / INST_FLOATS;
    if (out.data.length < total * INST_FLOATS) out.data = new Float32Array(Math.ceil(total * 1.5 + 64) * INST_FLOATS);
    const ranges: DrawRange[] = [];
    let first = 0;
    for (const mesh of MESH_ORDER) {
      const a = this.per.get(mesh);
      if (!a || !a.length) continue;
      out.data.set(a, first * INST_FLOATS);
      const count = a.length / INST_FLOATS;
      ranges.push({ mesh, first, count });
      first += count;
    }
    return { ranges, total };
  }
}

export const IDENTITY = m3.identity();
