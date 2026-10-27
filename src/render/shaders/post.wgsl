struct FsIn {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FsIn {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: FsIn;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

// ---------------------------------------------------------------- bloom

struct Blur { dir: vec4f };
@group(0) @binding(0) var<uniform> blur: Blur;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSamp: sampler;

@fragment
fn fsBright(v: FsIn) -> @location(0) vec4f {
  let t = blur.dir.zw;
  var c = vec3f(0.0);
  c += textureSample(srcTex, srcSamp, v.uv + vec2f(-t.x, -t.y)).rgb;
  c += textureSample(srcTex, srcSamp, v.uv + vec2f(t.x, -t.y)).rgb;
  c += textureSample(srcTex, srcSamp, v.uv + vec2f(-t.x, t.y)).rgb;
  c += textureSample(srcTex, srcSamp, v.uv + vec2f(t.x, t.y)).rgb;
  c *= 0.25;
  let l = max(c.r, max(c.g, c.b));
  let k = smoothstep(0.75, 1.6, l);
  return vec4f(c * k, 1.0);
}

@fragment
fn fsBlur(v: FsIn) -> @location(0) vec4f {
  let w = array<f32, 5>(0.227, 0.194, 0.121, 0.054, 0.016);
  var c = textureSample(srcTex, srcSamp, v.uv).rgb * w[0];
  for (var i = 1; i < 5; i++) {
    let o = blur.dir.xy * f32(i);
    c += textureSample(srcTex, srcSamp, v.uv + o).rgb * w[i];
    c += textureSample(srcTex, srcSamp, v.uv - o).rgb * w[i];
  }
  return vec4f(c, 1.0);
}
