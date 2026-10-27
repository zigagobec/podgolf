@group(0) @binding(0) var<uniform> lightVP: mat4x4f;
@group(0) @binding(1) var<storage, read> sInsts: array<Inst>;

@vertex
fn vsShadow(@location(0) p: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let I = sInsts[ii];
  if (I.params.z > 0.5) { return vec4f(0.0, 0.0, -10.0, 1.0); }
  return lightVP * I.model * vec4f(p, 1.0);
}
