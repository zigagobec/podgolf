struct View {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  camPos: vec4f,      // xyz, w = time
  lightDir: vec4f,    // xyz towards the light
  lightColor: vec4f,
  sky: vec4f,
  ground: vec4f,
  fog: vec4f,         // rgb, w = density
  hole: vec4f,        // x, rim y, z, radius
  camRight: vec4f,
  camUp: vec4f,
  counts: vec4f,      // x = point lights, y = funnel radius, z = cup depth
  pl: array<vec4f, 24>, // 12 lights: [pos, radius], [rgb, intensity]
};

struct Inst {
  model: mat4x4f,
  n0: vec4f,
  n1: vec4f,
  n2: vec4f,
  color: vec4f,   // rgb (sRGB), a = emissive
  params: vec4f,  // x = material, y = param, z = 1 if it casts no shadow
};

fn hash13(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash33(p: vec3f) -> vec3f {
  var p3 = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3f(1, 0, 0)), u.x), mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), u.x), u.y),
    mix(mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), u.x), mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), u.x), u.y),
    u.z);
}

fn fbm(p: vec3f) -> f32 {
  return noise3(p) * 0.5 + noise3(p * 2.03) * 0.3 + noise3(p * 4.11) * 0.2;
}

/** Distance to the nearest cell point (3D Worley). */
fn cell3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  var d = 8.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3f(f32(x), f32(y), f32(z));
        let r = o + hash33(i + o) - f;
        d = min(d, dot(r, r));
      }
    }
  }
  return sqrt(d);
}
