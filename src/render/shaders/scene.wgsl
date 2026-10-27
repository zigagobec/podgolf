@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var shadowSamp: sampler_comparison;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) lpos: vec3f,
  @location(3) @interpolate(flat) inst: u32,
};

@vertex
fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> VOut {
  let I = insts[ii];
  let w = I.model * vec4f(p, 1.0);
  var o: VOut;
  o.pos = view.viewProj * w;
  o.wpos = w.xyz;
  o.nrm = mat3x3f(I.n0.xyz, I.n1.xyz, I.n2.xyz) * n;
  o.lpos = p;
  o.inst = ii;
  return o;
}

struct Surf {
  albedo: vec3f,
  spec: f32,
  shine: f32,
  emissive: vec3f,
  rim: f32,
  wrap: f32,
  n: vec3f,
};

fn lin(c: vec3f) -> vec3f { return c * c; }

fn shadowAt(wpos: vec3f, n: vec3f) -> f32 {
  let p = view.lightViewProj * vec4f(wpos + n * 0.04, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || p.z > 1.0) { return 1.0; }
  let z = p.z - 0.002;
  let t = 1.0 / 2048.0;
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2f(f32(x), f32(y)) * t * 1.2, z);
    }
  }
  return s / 9.0;
}

fn material(I: Inst, wpos: vec3f, lpos: vec3f, nIn: vec3f) -> Surf {
  var s: Surf;
  let base = I.color.rgb;
  s.albedo = base;
  s.spec = 0.15;
  s.shine = 24.0;
  s.emissive = vec3f(0.0);
  s.rim = 0.15;
  s.wrap = 0.0;
  s.n = nIn;
  let matId = u32(I.params.x + 0.5);
  let param = I.params.y;
  switch matId {
    case 1u: { // kitchen tiles
      let g = wpos.xz / 2.0;
      let cell = floor(g);
      let f = fract(g);
      let chk = abs(fract((cell.x + cell.y) * 0.5) * 2.0);
      let tint = hash13(vec3f(cell, 1.0)) * 0.07;
      var c = mix(vec3f(0.8, 0.76, 0.66), vec3f(0.29, 0.36, 0.39), chk) * (0.96 + tint);
      let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      c = mix(vec3f(0.22, 0.21, 0.2), c, smoothstep(0.012, 0.03, edge));
      c *= 0.86 + 0.14 * fbm(wpos * 1.3);
      // Drain: steel ring, wet funnel.
      let d = distance(wpos.xz, view.hole.xz);
      let r = view.hole.w;
      let wet = 1.0 - smoothstep(r, view.counts.y, d);
      c = mix(c, c * vec3f(0.62, 0.7, 0.72), wet * 0.6);
      s.spec = 0.3 + wet * 0.6;
      s.shine = 40.0;
      if (d < r + 0.16) {
        let ring = sin(d * 120.0) * 0.5 + 0.5;
        c = vec3f(0.62, 0.64, 0.66) * (0.8 + 0.2 * ring);
        s.spec = 1.0;
        s.shine = 70.0;
      }
      s.albedo = c;
    }
    case 2u: { // wood (param 1 = cork, 2 = countertop)
      if (param > 0.5 && param < 1.5) {
        s.albedo = base * (0.75 + 0.35 * noise3(wpos * 18.0)) * (0.9 + 0.1 * noise3(wpos * 3.0));
      } else {
        let gr = sin(wpos.z * 9.0 + wpos.x * 0.7 + fbm(wpos * vec3f(0.4, 3.0, 3.0)) * 7.0);
        s.albedo = base * (0.82 + 0.16 * gr) * (0.9 + 0.12 * noise3(wpos * vec3f(0.3, 8.0, 8.0)));
        s.spec = 0.25;
      }
    }
    case 3u: { // food can
      let y = lpos.y;
      let ang = atan2(lpos.x, lpos.z);
      if (abs(y) > 0.42 || nIn.y > 0.9 || nIn.y < -0.9) {
        let ridge = sin((abs(y) + length(lpos.xz)) * 90.0) * 0.5 + 0.5;
        s.albedo = vec3f(0.7, 0.72, 0.75) * (0.8 + 0.2 * ridge);
        s.spec = 1.0;
        s.shine = 60.0;
      } else {
        var c = base;
        let band = abs(y - 0.18);
        c = mix(vec3f(0.97, 0.94, 0.86), c, smoothstep(0.05, 0.065, band));
        let logo = length(vec2f((fract((ang + param) / 3.14159 * 1.5) - 0.5) * 2.4, (y + 0.08) * 3.4));
        c = mix(vec3f(0.98, 0.92, 0.4), c, smoothstep(0.42, 0.46, logo));
        c = mix(vec3f(0.12, 0.08, 0.06), c, smoothstep(0.3, 0.34, abs(logo - 0.2) + 0.25));
        s.albedo = c;
        s.spec = 0.6;
        s.shine = 50.0;
      }
    }
    case 4u: { // cheese with holes
      let h = cell3(wpos * 2.2);
      var c = base * (0.92 + 0.12 * noise3(wpos * 6.0));
      c = mix(base * vec3f(0.85, 0.62, 0.3), c, smoothstep(0.22, 0.3, h));
      s.albedo = c;
      s.wrap = 0.4;
      s.spec = 0.2;
    }
    case 5u: { // sponge with scrub pad on top
      let pores = noise3(wpos * 22.0);
      var c = base * (0.8 + 0.3 * smoothstep(0.35, 0.6, pores));
      if (lpos.y > 0.22) {
        c = vec3f(0.12, 0.38, 0.2) * (0.7 + 0.5 * noise3(wpos * vec3f(40.0, 8.0, 40.0)));
      }
      s.albedo = c;
      s.wrap = 0.3;
      s.spec = 0.05;
    }
    case 6u: { // fur
      let st = noise3(lpos * vec3f(30.0, 30.0, 6.0) + vec3f(param * 7.0));
      s.albedo = base * (0.82 + 0.3 * st);
      s.rim = 0.3;
      s.wrap = 0.2;
      s.spec = 0.05;
    }
    case 7u: { // golf ball
      let q = normalize(lpos);
      let dimple = cell3(q * 6.0);
      var c = mix(vec3f(0.98, 0.97, 0.94), base, 0.85);
      if (abs(q.y) < 0.22) { c = vec3f(0.98, 0.97, 0.94); }
      c *= 0.85 + 0.15 * smoothstep(0.2, 0.55, dimple);
      s.albedo = c;
      s.spec = 0.9;
      s.shine = 80.0;
      s.rim = 0.6;
      s.emissive = lin(base) * 0.35;
    }
    case 8u: { // cereal box print
      let u = wpos.x * 0.9;
      var c = base;
      let stripe = fract(u * 0.6 + wpos.y * 0.25);
      c = mix(c, vec3f(0.98, 0.9, 0.35), step(0.75, stripe));
      let dots = length(fract(wpos.xy * vec2f(0.9, 1.1)) - 0.5);
      c = mix(vec3f(0.85, 0.15, 0.2), c, smoothstep(0.17, 0.2, dots));
      if (abs(nIn.y) > 0.9) { c = vec3f(0.62, 0.48, 0.32) * (0.9 + 0.2 * noise3(wpos * 12.0)); }
      s.albedo = c;
    }
    case 9u: { // pure glow
      s.albedo = vec3f(0.0);
      s.emissive = lin(base) * max(param, 1.0);
      s.rim = 0.0;
      s.spec = 0.0;
    }
    case 10u: { // drain grate at the bottom of the cup
      let slot = step(0.45, fract(wpos.x * 7.0));
      s.albedo = mix(vec3f(0.02), vec3f(0.5, 0.52, 0.55), slot);
      s.emissive = vec3f(0.15, 1.2, 0.5) * (1.0 - slot) * (0.7 + 0.3 * sin(view.camPos.w * 3.0));
      s.spec = 0.8;
    }
    case 11u: { // cabinet doors
      let u = select(wpos.z, wpos.x, abs(nIn.z) > abs(nIn.x));
      let fu = fract((u + 1.0) / 6.0) * 6.0;
      let inset = min(min(fu - 0.35, 5.65 - fu), min(wpos.y - 1.0, 4.4 - wpos.y));
      var c = base * (0.92 + 0.1 * noise3(wpos * 2.0));
      c *= mix(0.72, 1.0, smoothstep(0.0, 0.06, inset));
      c *= mix(1.12, 1.0, smoothstep(0.06, 0.14, inset));
      s.albedo = c;
      s.spec = 0.25;
    }
    case 12u: { // cup interior
      let t = clamp((view.hole.y - wpos.y) / view.counts.z, 0.0, 1.0);
      s.albedo = vec3f(0.35, 0.37, 0.4) * (1.0 - t * 0.8);
      s.emissive = vec3f(0.1, 0.9, 0.45) * t * t * 0.9;
      s.spec = 0.6;
    }
    case 13u: { // baguette crust with scoring
      let along = wpos.x * 1.1 + wpos.z * 0.3;
      let slash = smoothstep(0.08, 0.0, abs(fract(along) - 0.5) - 0.12) * smoothstep(0.2, 0.6, nIn.y);
      var c = base * (0.85 + 0.25 * noise3(wpos * 9.0));
      c = mix(c, vec3f(0.97, 0.88, 0.66), slash);
      c = mix(c, vec3f(0.95, 0.93, 0.88), smoothstep(0.75, 0.9, noise3(wpos * 14.0)) * 0.5);
      s.albedo = c;
      s.wrap = 0.3;
    }
    case 14u: { // milk puddle
      s.albedo = base;
      s.spec = 1.2;
      s.shine = 90.0;
      s.wrap = 0.5;
      s.emissive = vec3f(0.03, 0.03, 0.035);
    }
    case 15u: { // wallpaper + wainscot
      let u = select(wpos.z, wpos.x, abs(nIn.z) > abs(nIn.x));
      var c = base;
      if (wpos.y < 1.8) {
        c = vec3f(0.42, 0.28, 0.2) * (0.9 + 0.12 * sin(u * 6.0));
      } else {
        c = mix(base, base * vec3f(0.85, 0.9, 0.8), step(0.5, fract(u * 0.7)));
        let dots = length(fract(vec2f(u * 1.4, wpos.y * 1.4)) - 0.5);
        c = mix(vec3f(0.85, 0.75, 0.45), c, smoothstep(0.08, 0.1, dots));
      }
      s.albedo = c;
    }
    case 16u: { // fridge
      var c = base;
      if (abs(wpos.y - 6.0) < 0.05) { c *= 0.35; }
      s.albedo = c;
      s.spec = 0.6;
      s.shine = 40.0;
    }
    case 17u: { // skin
      s.albedo = base;
      s.wrap = 0.5;
      s.spec = 0.3;
      s.shine = 30.0;
      s.rim = 0.3;
    }
    case 18u: { // glossy eye
      s.albedo = base;
      s.spec = 2.0;
      s.shine = 120.0;
      s.rim = 0.3;
    }
    case 19u: { // shiny metal
      s.albedo = base * 0.75;
      s.spec = 1.0;
      s.shine = 60.0;
      s.rim = 0.4;
    }
    default: {}
  }
  s.albedo = lin(s.albedo);
  s.emissive += lin(base) * I.color.a;
  return s;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) nd: vec4f,
};

@fragment
fn fs(v: VOut, @builtin(front_facing) front: bool) -> FOut {
  let I = insts[v.inst];
  var nIn = normalize(v.nrm);
  if (!front) { nIn = -nIn; }
  let s = material(I, v.wpos, v.lpos, nIn);
  let N = s.n;
  let V = normalize(view.camPos.xyz - v.wpos);
  let L = normalize(view.lightDir.xyz);
  let sh = shadowAt(v.wpos, N);

  let ndl = dot(N, L);
  let w = (ndl + s.wrap) / (1.0 + s.wrap);
  let band = smoothstep(0.0, 0.05, w) * 0.6 + smoothstep(0.42, 0.48, w) * 0.4;
  let hemi = mix(view.ground.rgb, view.sky.rgb, N.y * 0.5 + 0.5);
  // The lamp above the counter makes a pool of light; corners fall off into the night.
  let pool = mix(0.42, 1.0, smoothstep(26.0, 6.0, distance(v.wpos.xz, vec2f(-1.0, 0.0))));
  var col = s.albedo * (hemi + view.lightColor.rgb * band * sh * pool);
  let H = normalize(L + V);
  let sp = pow(max(dot(N, H), 0.0), s.shine);
  col += view.lightColor.rgb * smoothstep(0.5, 0.56, sp) * s.spec * sh * 0.8;

  let n = u32(view.counts.x);
  for (var i = 0u; i < n; i++) {
    let pp = view.pl[i * 2u];
    let pc = view.pl[i * 2u + 1u];
    let d = pp.xyz - v.wpos;
    let dist = length(d);
    let att = clamp(1.0 - dist / pp.w, 0.0, 1.0);
    if (att <= 0.0) { continue; }
    let l = d / max(dist, 1e-4);
    let nd = dot(N, l);
    let lw = smoothstep(-0.1, 0.25, (nd + s.wrap) / (1.0 + s.wrap));
    col += s.albedo * pc.rgb * pc.w * att * att * lw;
    let hp = normalize(l + V);
    col += pc.rgb * pc.w * att * att * smoothstep(0.55, 0.6, pow(max(dot(N, hp), 0.0), s.shine)) * s.spec * 0.5;
  }

  let rim = 1.0 - max(dot(N, V), 0.0);
  col += (view.sky.rgb * 1.6 + vec3f(0.08)) * smoothstep(0.55, 0.7, rim) * s.rim;
  col += s.emissive;

  let dist = length(view.camPos.xyz - v.wpos);
  let fogK = 1.0 - exp(-dist * view.fog.w);
  col = mix(col, view.fog.rgb, fogK);

  var o: FOut;
  o.color = vec4f(col, 1.0);
  o.nd = vec4f(N, dist);
  return o;
}
