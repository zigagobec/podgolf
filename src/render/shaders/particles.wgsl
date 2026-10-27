struct Particle {
  pos: vec4f,   // xyz, size
  color: vec4f, // rgb (linear), alpha
  misc: vec4f,  // x = rotation, y = shape, z = mode (0 billboard, 1 flat on ground), w = additive
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> parts: array<Particle>;

struct POut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) idx: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));
  let c = corners[vi];
  let P = parts[ii];
  let r = P.misc.x;
  let rc = vec2f(c.x * cos(r) - c.y * sin(r), c.x * sin(r) + c.y * cos(r)) * P.pos.w;
  var w: vec3f;
  if (P.misc.z > 0.5) {
    w = P.pos.xyz + vec3f(rc.x, 0.0, rc.y);
  } else {
    w = P.pos.xyz + view.camRight.xyz * rc.x + view.camUp.xyz * rc.y;
  }
  var o: POut;
  o.pos = view.viewProj * vec4f(w, 1.0);
  o.uv = c;
  o.idx = ii;
  return o;
}

fn starShape(uv: vec2f) -> f32 {
  let a = atan2(uv.y, uv.x);
  let r = length(uv);
  let k = 0.55 + 0.45 * pow(abs(cos(a * 2.5)), 3.0);
  return 1.0 - smoothstep(k * 0.9 - 0.05, k * 0.9, r);
}

@fragment
fn fs(v: POut) -> @location(0) vec4f {
  let P = parts[v.idx];
  let r = length(v.uv);
  let shape = u32(P.misc.y + 0.5);
  var a = 0.0;
  var col = P.color.rgb;
  switch shape {
    case 0u: { a = smoothstep(1.0, 0.15, r); }                 // soft puff
    case 1u: {                                                 // inked disc
      a = 1.0 - smoothstep(0.92, 1.0, r);
      col = mix(col, vec3f(0.02), smoothstep(0.7, 0.78, r));
    }
    case 2u: { a = 1.0; }                                      // confetti square
    case 3u: { a = smoothstep(0.7, 0.85, r) * (1.0 - smoothstep(0.9, 1.0, r)); } // ring
    case 4u: {                                                 // star
      a = starShape(v.uv);
      col = mix(vec3f(0.05), col, step(0.0, starShape(v.uv * 1.25) - 0.5));
    }
    case 5u: {                                                 // aim chevron (points +y)
      let q = vec2f(abs(v.uv.x), v.uv.y);
      let d = abs(q.y + q.x * 0.9 - 0.25);
      a = (1.0 - smoothstep(0.2, 0.32, d)) * step(q.x, 0.85);
    }
    default: { a = pow(max(1.0 - r, 0.0), 2.2); }            // glow
  }
  a *= P.color.a;
  if (a < 0.003) { discard; }
  return vec4f(col * a, a * (1.0 - P.misc.w));
}
