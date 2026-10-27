import { describe, expect, it } from 'vitest';
import { BALL_R, CHARGE_TIME, NO_INPUT, World, type RatInput } from '../src/game/world';
import { forwardOf } from '../src/math';

/** Park both rats in a far corner so they don't interfere with ball tests. */
function quietWorld(): World {
  const w = new World();
  w.rats[0].pos = [-18, 0.4, -11];
  w.rats[1].pos = [-18, 0.4, 11];
  return w;
}

function run(w: World, seconds: number, inputs: RatInput[] = [NO_INPUT, NO_INPUT]) {
  const steps = Math.round(seconds * 120);
  for (let i = 0; i < steps; i++) w.step(1 / 120, inputs);
}

describe('ball', () => {
  it('rolls to a stop on flat floor and rests on it', () => {
    const w = quietWorld();
    const b = w.balls[0];
    b.pos = [-15, BALL_R, -5];
    b.vel = [10, 0, 0];
    run(w, 6);
    expect(Math.hypot(b.vel[0], b.vel[2])).toBeLessThan(0.01);
    expect(b.pos[1]).toBeCloseTo(BALL_R, 2);
    // ~ (1/k)(v0 - a*t) with a=3, k=0.5
    expect(b.pos[0] - -15).toBeGreaterThan(6);
    expect(b.pos[0] - -15).toBeLessThan(14);
  });

  it('drops into the hole when rolled slowly over it', () => {
    const w = quietWorld();
    const h = w.course.hole;
    const b = w.balls[0];
    b.pos = [h.x - 2.2, BALL_R, h.z];
    b.vel = [3.2, 0, 0];
    run(w, 4);
    expect(b.sunk).toBe(true);
    expect(w.winner).toBe(0);
  });

  it('is pulled in by the drain funnel when it stops close by', () => {
    const w = quietWorld();
    const h = w.course.hole;
    const b = w.balls[1];
    b.pos = [h.x + 0.9, w.course.floorY(h.x + 0.9, h.z) + BALL_R, h.z];
    b.vel = [0, 0, 0];
    run(w, 4);
    expect(b.sunk).toBe(true);
    expect(w.winner).toBe(1);
  });

  it('skips over the hole when it is too fast', () => {
    const w = quietWorld();
    const h = w.course.hole;
    const b = w.balls[0];
    b.pos = [h.x - 2.2, BALL_R, h.z];
    b.vel = [16, 0, 0];
    run(w, 0.4);
    expect(b.sunk).toBe(false);
    expect(b.pos[0]).toBeGreaterThan(h.x + 1);
  });

  it('bounces back off a wall', () => {
    const w = quietWorld();
    const b = w.balls[0];
    b.pos = [-17, BALL_R, 6];
    b.vel = [0, 0, 12];
    run(w, 1);
    expect(b.vel[2]).toBeLessThan(0);
    expect(b.pos[2]).toBeLessThan(13);
  });

  it('gets swatted by the spinning spoon', () => {
    const w = quietWorld();
    const sp = w.course.spoon;
    // Find where the handle will be in 0.5 s and park the ball in its path.
    const ang = 0.6 + 0.5 * sp.speed + 0.15;
    const f = forwardOf(ang);
    const b = w.balls[0];
    b.pos = [sp.pivot[0] + f[0] * 2, BALL_R, sp.pivot[2] + f[2] * 2];
    b.vel = [0, 0, 0];
    run(w, 1);
    expect(Math.hypot(b.vel[0], b.vel[2]) + Math.hypot(b.pos[0] - (sp.pivot[0] + f[0] * 2), b.pos[2] - (sp.pivot[2] + f[2] * 2))).toBeGreaterThan(0.5);
  });
});

describe('rat', () => {
  it('walks forward and turns', () => {
    const w = quietWorld();
    const r = w.rats[0];
    r.pos = [-10, 0.4, -6];
    r.yaw = Math.PI / 2;
    run(w, 1, [{ throttle: 1, steer: 0, action: false }, NO_INPUT]);
    expect(r.pos[0]).toBeGreaterThan(-6);
    const yaw0 = r.yaw;
    run(w, 0.3, [{ throttle: 0, steer: 1, action: false }, NO_INPUT]);
    expect(r.yaw).toBeLessThan(yaw0);
  });

  it('charges, lunges and smacks the ball with its snout', () => {
    const w = quietWorld();
    const r = w.rats[0];
    const b = w.balls[0];
    r.pos = [-10, 0.4, -6];
    r.yaw = Math.PI / 2;
    b.pos = [-8.8, BALL_R, -6];
    run(w, 0.2);
    // Hold for a full upward sweep, then release.
    run(w, CHARGE_TIME * 0.95, [{ throttle: 0, steer: 0, action: true }, NO_INPUT]);
    expect(r.charge).toBeGreaterThan(0.8);
    run(w, 0.3, [NO_INPUT, NO_INPUT]);
    const ev = w.drainEvents();
    expect(ev.some((e) => e.type === 'hit')).toBe(true);
    expect(b.vel[0]).toBeGreaterThan(10);
    expect(r.strokes).toBe(1);
  });

  it('a weak tap moves the ball only a little', () => {
    const w = quietWorld();
    const r = w.rats[0];
    const b = w.balls[0];
    r.pos = [-10, 0.4, -6];
    r.yaw = Math.PI / 2;
    b.pos = [-9.1, BALL_R, -6];
    run(w, 0.1);
    run(w, 0.05, [{ throttle: 0, steer: 0, action: true }, NO_INPUT]);
    run(w, 4);
    expect(b.pos[0]).toBeGreaterThan(-9);
    expect(b.pos[0]).toBeLessThan(-4);
  });

  it('climbs the cheese ramp onto the cutting board', () => {
    const w = quietWorld();
    const r = w.rats[0];
    r.pos = [-9, 0.4, 7];
    r.yaw = Math.PI / 2;
    run(w, 1.4, [{ throttle: 1, steer: 0, action: false }, NO_INPUT]);
    expect(r.pos[0]).toBeGreaterThan(-3.5);
    expect(r.pos[1]).toBeGreaterThan(0.5 + 0.3);
  });

  it('a lunge into the other rat knocks it over', () => {
    const w = new World();
    const [a, b] = w.rats;
    a.pos = [0, 0.4, -10];
    a.yaw = Math.PI / 2;
    b.pos = [1.6, 0.4, -10];
    run(w, 0.1);
    run(w, 0.5, [{ throttle: 0, steer: 0, action: true }, NO_INPUT]);
    run(w, 0.3);
    expect(w.drainEvents().some((e) => e.type === 'bonk')).toBe(true);
    expect(b.stun).toBeGreaterThan(0);
  });
});
