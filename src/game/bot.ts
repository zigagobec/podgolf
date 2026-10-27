import { forwardOf, v3, wrapAngle, type Vec3 } from '../math';
import { BALL_R, CHARGE_TIME, HIT_MAX, HIT_MIN, NO_INPUT, SNOUT_FWD, SNOUT_R, type RatInput, type World } from './world';

interface Plan {
  dir: Vec3;
  charge: number;
  ballAt: Vec3;
}

/** Simple computer opponent: searches shots with the real physics, walks behind the ball, charges, releases. */
export class Bot {
  private plan: Plan | null = null;
  private phase: 'plan' | 'walk' | 'turn' | 'charge' | 'wait' = 'plan';
  private timer = 0;
  private stuck = 0;
  private detour = 0;

  constructor(private me: number, private skill = 0.75) {}

  reset(): void {
    this.plan = null;
    this.phase = 'plan';
    this.timer = 0;
  }

  think(w: World, dt: number): RatInput {
    const r = w.rats[this.me];
    const b = w.balls[this.me];
    if (b.sunk || w.winner !== null) return NO_INPUT;
    if (r.stun > 0) {
      this.phase = 'wait';
      this.timer = 0.3;
      return NO_INPUT;
    }
    this.timer -= dt;
    const ballSpeed = Math.hypot(b.vel[0], b.vel[2]);

    if (this.phase === 'wait') {
      if (this.timer > 0 || ballSpeed > 0.25) return NO_INPUT;
      this.phase = 'plan';
    }
    if (this.phase === 'plan') {
      if (ballSpeed > 0.25) return NO_INPUT;
      this.plan = this.search(w);
      this.phase = 'walk';
      this.stuck = 0;
    }
    const plan = this.plan!;
    if (v3.dist(plan.ballAt, b.pos) > 0.6) {
      this.phase = ballSpeed > 0.25 ? 'wait' : 'plan';
      return NO_INPUT;
    }
    const standOff = SNOUT_FWD + SNOUT_R + BALL_R + 0.35;
    const spot: Vec3 = [b.pos[0] - plan.dir[0] * standOff, r.pos[1], b.pos[2] - plan.dir[2] * standOff];
    const aimYaw = Math.atan2(plan.dir[0], plan.dir[2]);

    if (this.phase === 'walk') {
      const toSpot = v3.sub(spot, r.pos);
      const dist = Math.hypot(toSpot[0], toSpot[2]);
      if (dist < 0.22) {
        this.phase = 'turn';
        return NO_INPUT;
      }
      // Go around the ball if it is in the way.
      let target = spot;
      const toBall = v3.sub(b.pos, r.pos);
      const along = (toBall[0] * toSpot[0] + toBall[2] * toSpot[2]) / Math.max(dist, 1e-3);
      if (along > 0 && along < dist) {
        const px = r.pos[0] + (toSpot[0] / dist) * along;
        const pz = r.pos[2] + (toSpot[2] / dist) * along;
        if (Math.hypot(px - b.pos[0], pz - b.pos[2]) < 1.0) {
          const side: Vec3 = [-toSpot[2] / dist, 0, toSpot[0] / dist];
          target = [b.pos[0] + side[0] * 1.4, 0, b.pos[2] + side[2] * 1.4];
        }
      }
      if (this.detour > 0) {
        this.detour -= dt;
        return { throttle: -0.6, steer: 1, action: false };
      }
      const speed = Math.hypot(r.vel[0], r.vel[2]);
      this.stuck = speed < 0.6 ? this.stuck + dt : 0;
      if (this.stuck > 0.8) {
        this.stuck = 0;
        this.detour = 0.5;
      }
      const want = Math.atan2(target[0] - r.pos[0], target[2] - r.pos[2]);
      const diff = wrapAngle(want - r.yaw);
      return { throttle: Math.abs(diff) < 0.7 ? (dist < 1.2 ? 0.5 : 1) : 0.15, steer: Math.max(-1, Math.min(1, -diff * 3)), action: false };
    }
    const diff = wrapAngle(aimYaw - r.yaw);
    if (this.phase === 'turn') {
      if (Math.abs(diff) < 0.04) {
        this.phase = 'charge';
        return { throttle: 0, steer: 0, action: true };
      }
      return { throttle: 0, steer: Math.max(-1, Math.min(1, -diff * 4)), action: false };
    }
    // Charging: release on the way up when the meter reaches the planned power.
    if (r.charging && r.chargePhase < 1 && r.charge >= plan.charge - 0.015) {
      this.phase = 'wait';
      this.timer = 0.6;
      return NO_INPUT;
    }
    if (r.charging && r.chargePhase >= 1 && r.charge <= plan.charge + 0.015) {
      this.phase = 'wait';
      this.timer = 0.6;
      return NO_INPUT;
    }
    return { throttle: 0, steer: Math.max(-1, Math.min(1, -diff * 3)), action: true };
  }

  private search(w: World): Plan {
    const b = w.balls[this.me];
    const hole = w.course.hole;
    const direct = Math.atan2(hole.x - b.pos[0], hole.z - b.pos[2]);
    const angles: number[] = [];
    for (let k = -6; k <= 6; k++) angles.push(direct + k * 0.15);
    for (let k = 0; k < 12; k++) angles.push(direct + Math.PI / 6 + (k * Math.PI) / 6);
    const charges = [0.12, 0.22, 0.34, 0.47, 0.6, 0.75, 0.9];
    let best: Plan = { dir: forwardOf(direct), charge: 0.5, ballAt: v3.copy(b.pos) };
    let bestScore = Infinity;
    const lead = CHARGE_TIME * 0.7;
    for (const a of angles) {
      const f = forwardOf(a);
      for (const c of charges) {
        const pw = HIT_MIN + (HIT_MAX - HIT_MIN) * c;
        const res = w.predictBall(this.me, b.pos, [f[0] * pw, 0.4 + c * 1.2, f[2] * pw], 4.5);
        void lead;
        let score = res.sunk ? -100 + res.t : Math.hypot(res.pos[0] - hole.x, res.pos[2] - hole.z);
        if (!res.sunk && w.course.stickyAt(res.pos[0], res.pos[2])) score += 2;
        if (score < bestScore) {
          bestScore = score;
          best = { dir: f, charge: c, ballAt: v3.copy(b.pos) };
        }
      }
    }
    // Human-ish error.
    const err = (1 - this.skill) * 0.25;
    const a = Math.atan2(best.dir[0], best.dir[2]) + (Math.random() - 0.5) * err;
    best.dir = forwardOf(a);
    best.charge = Math.max(0.06, Math.min(0.98, best.charge + (Math.random() - 0.5) * err * 0.6));
    return best;
  }
}
