import { mat4, v3, type Mat4, type Vec3 } from '../math';
import type { Gpu } from './gpu';
import { INST_FLOATS, MESH_ORDER, type DrawRange } from './instances';
import type { AnyMesh, MeshData } from './meshes';
import commonWGSL from './shaders/common.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';
import particlesWGSL from './shaders/particles.wgsl?raw';
import postWGSL from './shaders/post.wgsl?raw';
import sceneWGSL from './shaders/scene.wgsl?raw';
import shadowWGSL from './shaders/shadow.wgsl?raw';

const VIEW_SLOT = 768;
const VIEW_FLOATS = 168;
const SHADOW_SIZE = 2048;
const MSAA = 4;
export const PARTICLE_FLOATS = 12;
const MAX_LIGHTS = 12;

export interface PointLight {
  pos: Vec3;
  radius: number;
  color: Vec3;
  intensity: number;
}

export interface ViewParams {
  viewProj: Mat4;
  camPos: Vec3;
  camRight: Vec3;
  camUp: Vec3;
  /** Pixel rect x, y, w, h. */
  rect: [number, number, number, number];
  flash: number;
  saturation: number;
  darken: number;
}

export interface Frame {
  instances: Float32Array;
  instanceCount: number;
  ranges: DrawRange[];
  particles: Float32Array;
  particleCount: number;
  lights: PointLight[];
  views: ViewParams[];
  time: number;
  /** 0 = side by side, 1 = stacked. */
  split: number;
  hole: { x: number; y: number; z: number; r: number; funnelR: number; depth: number };
}

export const LIGHT_DIR = v3.normalize([-0.32, 1, -0.38]);
const LIGHT_COLOR: Vec3 = [1.12, 0.94, 0.74];
const SKY: Vec3 = [0.16, 0.2, 0.34];
const GROUND: Vec3 = [0.1, 0.075, 0.07];
const FOG: [number, number, number, number] = [0.025, 0.03, 0.055, 0.011];

export class Renderer {
  private device: GPUDevice;
  private vbuf: GPUBuffer;
  private ibuf: GPUBuffer;
  private meshRanges = new Map<AnyMesh, { first: number; count: number; base: number }>();
  private instBuf: GPUBuffer;
  private partBuf: GPUBuffer;
  private viewBuf: GPUBuffer;
  private lightBuf: GPUBuffer;
  private postBuf: GPUBuffer;
  private blurBufs: GPUBuffer[];
  private shadowTex: GPUTexture;
  private scenePipe: GPURenderPipeline;
  private partPipe: GPURenderPipeline;
  private shadowPipe: GPURenderPipeline;
  private brightPipe: GPURenderPipeline;
  private blurPipe: GPURenderPipeline;
  private compPipe: GPURenderPipeline;
  private sceneBGL: GPUBindGroupLayout;
  private partBGL: GPUBindGroupLayout;
  private shadowBGL: GPUBindGroupLayout;
  private blurBGL: GPUBindGroupLayout;
  private compBGL: GPUBindGroupLayout;
  private linSamp: GPUSampler;
  private cmpSamp: GPUSampler;
  private sceneBG!: GPUBindGroup;
  private partBG!: GPUBindGroup;
  private shadowBG!: GPUBindGroup;
  private targets: {
    w: number; h: number;
    colorMS: GPUTexture; ndMS: GPUTexture; depth: GPUTexture;
    scene: GPUTexture; nd: GPUTexture; bloomA: GPUTexture; bloomB: GPUTexture;
    brightBG: GPUBindGroup; blurHBG: GPUBindGroup; blurVBG: GPUBindGroup; compBG: GPUBindGroup;
  } | null = null;
  private lightVP: Mat4;

  constructor(private gpu: Gpu, meshes: Record<AnyMesh, MeshData>) {
    const d = (this.device = gpu.device);
    // Geometry: all meshes in one vertex + index buffer.
    const verts: number[] = [];
    const idx: number[] = [];
    for (const name of MESH_ORDER) {
      const m = meshes[name];
      this.meshRanges.set(name, { first: idx.length, count: m.i.length, base: verts.length / 6 });
      verts.push(...m.v);
      idx.push(...m.i);
    }
    this.vbuf = d.createBuffer({ size: verts.length * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.vbuf, 0, new Float32Array(verts));
    this.ibuf = d.createBuffer({ size: Math.ceil((idx.length * 4) / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.ibuf, 0, new Uint32Array(idx));

    this.instBuf = this.makeStorage(512 * INST_FLOATS * 4);
    this.partBuf = this.makeStorage(2048 * PARTICLE_FLOATS * 4);
    this.viewBuf = d.createBuffer({ size: VIEW_SLOT * 2, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lightBuf = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postBuf = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurBufs = [0, 1, 2].map(() => d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.shadowTex = d.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.linSamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.cmpSamp = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.sceneBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: V | F, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: F, texture: { sampleType: 'depth' } },
        { binding: 3, visibility: F, sampler: { type: 'comparison' } },
      ],
    });
    this.partBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: V | F, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.shadowBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V, buffer: { type: 'uniform' } },
        { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.blurBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, sampler: { type: 'filtering' } },
      ],
    });
    this.compBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, texture: { sampleType: 'float' } },
        { binding: 3, visibility: F, texture: { sampleType: 'float' } },
        { binding: 4, visibility: F, sampler: { type: 'filtering' } },
      ],
    });

    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    };
    const sceneMod = d.createShaderModule({ label: 'scene', code: commonWGSL + sceneWGSL });
    const partMod = d.createShaderModule({ label: 'particles', code: commonWGSL + particlesWGSL });
    const shadowMod = d.createShaderModule({ label: 'shadow', code: commonWGSL + shadowWGSL });
    const postMod = d.createShaderModule({ label: 'post', code: postWGSL });
    const compMod = d.createShaderModule({ label: 'composite', code: compositeWGSL });
    const hdr: GPUTextureFormat = 'rgba16float';

    this.scenePipe = d.createRenderPipeline({
      label: 'scene',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.sceneBGL] }),
      vertex: { module: sceneMod, entryPoint: 'vs', buffers: [vertexLayout] },
      fragment: { module: sceneMod, entryPoint: 'fs', targets: [{ format: hdr }, { format: hdr }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: MSAA },
    });
    this.partPipe = d.createRenderPipeline({
      label: 'particles',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.partBGL] }),
      vertex: { module: partMod, entryPoint: 'vs' },
      fragment: {
        module: partMod,
        entryPoint: 'fs',
        targets: [
          {
            format: hdr,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
          { format: hdr, writeMask: 0 },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: MSAA },
    });
    this.shadowPipe = d.createRenderPipeline({
      label: 'shadow',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.shadowBGL] }),
      vertex: { module: shadowMod, entryPoint: 'vsShadow', buffers: [vertexLayout] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 },
    });
    const fullscreen = (mod: GPUShaderModule, entry: string, format: GPUTextureFormat, bgl: GPUBindGroupLayout, label: string) =>
      d.createRenderPipeline({
        label,
        layout: d.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: mod, entryPoint: 'vsFull' },
        fragment: { module: mod, entryPoint: entry, targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    this.brightPipe = fullscreen(postMod, 'fsBright', hdr, this.blurBGL, 'bright');
    this.blurPipe = fullscreen(postMod, 'fsBlur', hdr, this.blurBGL, 'blur');
    this.compPipe = fullscreen(compMod, 'fs', gpu.format, this.compBGL, 'composite');

    this.lightVP = this.computeLightVP();
    d.queue.writeBuffer(this.lightBuf, 0, this.lightVP as Float32Array<ArrayBuffer>);
    this.rebuildStorageBindGroups();
  }

  private makeStorage(size: number): GPUBuffer {
    return this.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  private computeLightVP(): Mat4 {
    const target: Vec3 = [0, 0, 0];
    const eye = v3.addScaled(target, LIGHT_DIR, 40);
    const view = mat4.lookAt(eye, target, [0, 1, 0]);
    const proj = mat4.ortho(-27, 27, -27, 27, 5, 80);
    return mat4.multiply(proj, view);
  }

  private rebuildStorageBindGroups(): void {
    const d = this.device;
    this.sceneBG = d.createBindGroup({
      layout: this.sceneBGL,
      entries: [
        { binding: 0, resource: { buffer: this.viewBuf, size: VIEW_FLOATS * 4 } },
        { binding: 1, resource: { buffer: this.instBuf } },
        { binding: 2, resource: this.shadowTex.createView() },
        { binding: 3, resource: this.cmpSamp },
      ],
    });
    this.partBG = d.createBindGroup({
      layout: this.partBGL,
      entries: [
        { binding: 0, resource: { buffer: this.viewBuf, size: VIEW_FLOATS * 4 } },
        { binding: 1, resource: { buffer: this.partBuf } },
      ],
    });
    this.shadowBG = d.createBindGroup({
      layout: this.shadowBGL,
      entries: [
        { binding: 0, resource: { buffer: this.lightBuf } },
        { binding: 1, resource: { buffer: this.instBuf } },
      ],
    });
  }

  private ensureTargets(w: number, h: number): NonNullable<Renderer['targets']> {
    if (this.targets && this.targets.w === w && this.targets.h === h) return this.targets;
    const d = this.device;
    if (this.targets) {
      for (const t of [this.targets.colorMS, this.targets.ndMS, this.targets.depth, this.targets.scene, this.targets.nd, this.targets.bloomA, this.targets.bloomB]) t.destroy();
    }
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    const colorMS = d.createTexture({ size: [w, h], format: 'rgba16float', sampleCount: MSAA, usage: RA });
    const ndMS = d.createTexture({ size: [w, h], format: 'rgba16float', sampleCount: MSAA, usage: RA });
    const depth = d.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: MSAA, usage: RA });
    const scene = d.createTexture({ size: [w, h], format: 'rgba16float', usage: RA | TB });
    const nd = d.createTexture({ size: [w, h], format: 'rgba16float', usage: RA | TB });
    const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
    const bloomA = d.createTexture({ size: [bw, bh], format: 'rgba16float', usage: RA | TB });
    const bloomB = d.createTexture({ size: [bw, bh], format: 'rgba16float', usage: RA | TB });
    d.queue.writeBuffer(this.blurBufs[0], 0, new Float32Array([0, 0, 1 / w, 1 / h]));
    d.queue.writeBuffer(this.blurBufs[1], 0, new Float32Array([1.5 / bw, 0, 0, 0]));
    d.queue.writeBuffer(this.blurBufs[2], 0, new Float32Array([0, 1.5 / bh, 0, 0]));
    const blurBG = (buf: GPUBuffer, src: GPUTexture) =>
      d.createBindGroup({
        layout: this.blurBGL,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: src.createView() },
          { binding: 2, resource: this.linSamp },
        ],
      });
    const compBG = d.createBindGroup({
      layout: this.compBGL,
      entries: [
        { binding: 0, resource: { buffer: this.postBuf } },
        { binding: 1, resource: scene.createView() },
        { binding: 2, resource: nd.createView() },
        { binding: 3, resource: bloomA.createView() },
        { binding: 4, resource: this.linSamp },
      ],
    });
    this.targets = {
      w, h, colorMS, ndMS, depth, scene, nd, bloomA, bloomB,
      brightBG: blurBG(this.blurBufs[0], scene),
      blurHBG: blurBG(this.blurBufs[1], bloomA),
      blurVBG: blurBG(this.blurBufs[2], bloomB),
      compBG,
    };
    return this.targets;
  }

  render(f: Frame): void {
    const d = this.device;
    const canvas = this.gpu.canvas;
    const T = this.ensureTargets(canvas.width, canvas.height);

    // Grow storage buffers when needed.
    const instBytes = f.instanceCount * INST_FLOATS * 4;
    const partBytes = Math.max(1, f.particleCount) * PARTICLE_FLOATS * 4;
    let rebuild = false;
    if (instBytes > this.instBuf.size) {
      this.instBuf.destroy();
      this.instBuf = this.makeStorage(Math.ceil(instBytes * 1.5));
      rebuild = true;
    }
    if (partBytes > this.partBuf.size) {
      this.partBuf.destroy();
      this.partBuf = this.makeStorage(Math.ceil(partBytes * 1.5));
      rebuild = true;
    }
    if (rebuild) this.rebuildStorageBindGroups();
    d.queue.writeBuffer(this.instBuf, 0, f.instances as Float32Array<ArrayBuffer>, 0, f.instanceCount * INST_FLOATS);
    if (f.particleCount) d.queue.writeBuffer(this.partBuf, 0, f.particles as Float32Array<ArrayBuffer>, 0, f.particleCount * PARTICLE_FLOATS);

    // Per-view uniforms.
    const vb = new Float32Array((VIEW_SLOT / 4) * 2);
    f.views.forEach((v, i) => {
      const o = (i * VIEW_SLOT) / 4;
      vb.set(v.viewProj, o);
      vb.set(this.lightVP, o + 16);
      vb.set([v.camPos[0], v.camPos[1], v.camPos[2], f.time], o + 32);
      vb.set([LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2], 0], o + 36);
      vb.set([...LIGHT_COLOR, 0], o + 40);
      vb.set([...SKY, 0], o + 44);
      vb.set([...GROUND, 0], o + 48);
      vb.set(FOG, o + 52);
      vb.set([f.hole.x, f.hole.y, f.hole.z, f.hole.r], o + 56);
      vb.set([...v.camRight, 0], o + 60);
      vb.set([...v.camUp, 0], o + 64);
      const lights = f.lights.slice(0, MAX_LIGHTS);
      vb.set([lights.length, f.hole.funnelR, f.hole.depth, 0], o + 68);
      lights.forEach((l, k) => {
        vb.set([l.pos[0], l.pos[1], l.pos[2], l.radius], o + 72 + k * 8);
        vb.set([l.color[0], l.color[1], l.color[2], l.intensity], o + 76 + k * 8);
      });
    });
    d.queue.writeBuffer(this.viewBuf, 0, vb);

    const edgePx = Math.max(1, Math.round(canvas.height / 1000));
    const v0 = f.views[0], v1 = f.views[1] ?? f.views[0];
    d.queue.writeBuffer(
      this.postBuf,
      0,
      new Float32Array([
        canvas.width, canvas.height, 1 / canvas.width, 1 / canvas.height,
        f.split, Math.max(4, Math.round(canvas.height / 160)), f.time % 1000, edgePx,
        v0.flash, v0.saturation, v0.darken, 0,
        v1.flash, v1.saturation, v1.darken, 0,
      ]),
    );

    const enc = d.createCommandEncoder();
    const drawMeshes = (pass: GPURenderPassEncoder) => {
      pass.setVertexBuffer(0, this.vbuf);
      pass.setIndexBuffer(this.ibuf, 'uint32');
      for (const r of f.ranges) {
        const m = this.meshRanges.get(r.mesh)!;
        pass.drawIndexed(m.count, r.count, m.first, m.base, r.first);
      }
    };

    // Shadow map.
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(this.shadowPipe);
      pass.setBindGroup(0, this.shadowBG);
      drawMeshes(pass);
      pass.end();
    }

    // Both split-screen views into one MSAA pass.
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: T.colorMS.createView(), resolveTarget: T.scene.createView(), clearValue: { r: 0.012, g: 0.014, b: 0.026, a: 1 }, loadOp: 'clear', storeOp: 'discard' },
          { view: T.ndMS.createView(), resolveTarget: T.nd.createView(), clearValue: { r: 0, g: 1, b: 0, a: 400 }, loadOp: 'clear', storeOp: 'discard' },
        ],
        depthStencilAttachment: { view: T.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      f.views.forEach((v, i) => {
        const [x, y, w, h] = v.rect;
        pass.setViewport(x, y, w, h, 0, 1);
        pass.setScissorRect(x, y, w, h);
        pass.setPipeline(this.scenePipe);
        pass.setBindGroup(0, this.sceneBG, [i * VIEW_SLOT]);
        drawMeshes(pass);
        if (f.particleCount) {
          pass.setPipeline(this.partPipe);
          pass.setBindGroup(0, this.partBG, [i * VIEW_SLOT]);
          pass.draw(6, f.particleCount);
        }
      });
      pass.end();
    }

    // Bloom: bright pass to quarter res, then separable blur.
    const fsPass = (target: GPUTexture, pipe: GPURenderPipeline, bg: GPUBindGroup) => {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    };
    fsPass(T.bloomA, this.brightPipe, T.brightBG);
    fsPass(T.bloomB, this.blurPipe, T.blurHBG);
    fsPass(T.bloomA, this.blurPipe, T.blurVBG);

    const out = this.gpu.context.getCurrentTexture();
    fsPass(out, this.compPipe, T.compBG);
    d.queue.submit([enc.finish()]);
  }
}
