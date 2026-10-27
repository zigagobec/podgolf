struct Post {
  res: vec4f,    // w, h, 1/w, 1/h
  split: vec4f,  // x = 0 side by side / 1 stacked, y = divider px, z = time, w = edge px
  view0: vec4f,  // flash, saturation, darken, _
  view1: vec4f,
};

@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var ndTex: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var linSamp: sampler;

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

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(v: FsIn) -> @location(0) vec4f {
  let px = vec2i(v.pos.xy);
  let size = vec2i(post.res.xy);
  // Which split-screen view is this pixel in, and its rect?
  var lo = vec2i(0);
  var hi = size;
  var vid = 0;
  if (post.split.x > 1.5) {
    // Single full-screen view.
  } else if (post.split.x < 0.5) {
    let mid = size.x / 2;
    if (px.x >= mid) { vid = 1; lo.x = mid; } else { hi.x = mid; }
  } else {
    let mid = size.y / 2;
    if (px.y >= mid) { vid = 1; lo.y = mid; } else { hi.y = mid; }
  }
  let vp = select(post.view0, post.view1, vid == 1);

  var col = textureLoad(sceneTex, px, 0).rgb;
  let c = textureLoad(ndTex, px, 0);
  let t = i32(post.split.w);
  let pl = clamp(px + vec2i(-t, 0), lo, hi - 1);
  let pr = clamp(px + vec2i(t, 0), lo, hi - 1);
  let pu = clamp(px + vec2i(0, -t), lo, hi - 1);
  let pd = clamp(px + vec2i(0, t), lo, hi - 1);
  let l = textureLoad(ndTex, pl, 0);
  let r = textureLoad(ndTex, pr, 0);
  let u = textureLoad(ndTex, pu, 0);
  let d = textureLoad(ndTex, pd, 0);
  let lap = max(abs(l.w + r.w - 2.0 * c.w), abs(u.w + d.w - 2.0 * c.w)) / max(c.w, 0.5);
  var edge = smoothstep(0.03, 0.08, lap);
  let nd = max(max(1.0 - dot(c.xyz, l.xyz), 1.0 - dot(c.xyz, r.xyz)), max(1.0 - dot(c.xyz, u.xyz), 1.0 - dot(c.xyz, d.xyz)));
  edge = max(edge, smoothstep(0.3, 0.5, nd));
  edge *= 1.0 - smoothstep(25.0, 60.0, c.w);
  col = mix(col, vec3f(0.012, 0.008, 0.016), edge * 0.85);

  col += textureSample(bloomTex, linSamp, v.uv).rgb * 0.75;
  col = aces(col * 1.1);

  // Per-view grading: saturation (loser goes grey), flash, darken.
  let g = dot(col, vec3f(0.299, 0.587, 0.114));
  col = mix(vec3f(g), col, vp.y);
  col = mix(col, vec3f(1.0, 0.97, 0.9), vp.x);
  col *= 1.0 - vp.z;

  let local = (vec2f(px - lo) + 0.5) / vec2f(hi - lo);
  let q = (local - 0.5) * vec2f(1.0, 1.15);
  col *= 1.0 - smoothstep(0.25, 0.75, dot(q, q) * 1.6) * 0.45;

  let grain = fract(sin(dot(vec2f(px) + post.split.z * 61.0, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += grain * 0.025;
  col = sqrt(max(col, vec3f(0.0)));

  // Divider between the two views.
  let half = post.split.y * 0.5;
  var dd = 0.0;
  if (post.split.x < 0.5) { dd = abs(v.pos.x - f32(size.x) * 0.5); } else { dd = abs(v.pos.y - f32(size.y) * 0.5); }
  if (dd < half && post.split.x < 1.5) { col = vec3f(0.035, 0.03, 0.04); }
  return vec4f(col, 1.0);
}
