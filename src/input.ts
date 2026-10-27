import type { RatInput } from './game/world';

const KEYS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], action: ['Space', 'KeyF'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], action: ['Enter', 'NumpadEnter', 'ShiftRight', 'Numpad0', 'ControlRight', 'Slash'] },
];

const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Slash']);

/** Keyboard + gamepad state for two players on one machine. */
export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<string>();
  /** Scripted overrides (bots, tests). */
  override: (RatInput | null)[] = [null, null];

  constructor() {
    addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  private pad(i: number): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    const list = [...pads].filter((p): p is Gamepad => !!p && p.connected);
    return list[i] ?? null;
  }

  read(player: number): RatInput {
    const o = this.override[player];
    if (o) return o;
    const k = KEYS[player];
    let throttle = (this.any(k.up) ? 1 : 0) - (this.any(k.down) ? 1 : 0);
    let steer = (this.any(k.right) ? 1 : 0) - (this.any(k.left) ? 1 : 0);
    let action = this.any(k.action);
    const p = this.pad(player);
    if (p) {
      const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
      const ax = dz(p.axes[0] ?? 0);
      const ay = dz(p.axes[1] ?? 0);
      const b = (n: number) => !!p.buttons[n]?.pressed;
      if (ax) steer = ax;
      if (ay) throttle = -ay;
      if (b(12)) throttle = 1;
      if (b(13)) throttle = -1;
      if (b(14)) steer = -1;
      if (b(15)) steer = 1;
      const rt = p.buttons[7]?.value ?? 0;
      if (rt > 0.2) throttle = Math.max(throttle, rt);
      action = action || b(0) || b(1) || b(5);
    }
    return { throttle, steer, action };
  }

  /** Did the player press their action key since the last call? */
  tapped(player: number): boolean {
    const k = KEYS[player];
    let hit = k.action.some((c) => this.pressedOnce.has(c));
    const p = this.pad(player);
    if (p && (p.buttons[0]?.pressed || p.buttons[9]?.pressed)) {
      const key = `pad${player}`;
      if (!this.down.has(key)) {
        this.down.add(key);
        hit = true;
      }
    } else this.down.delete(`pad${player}`);
    for (const c of k.action) this.pressedOnce.delete(c);
    return hit;
  }

  keyTapped(code: string): boolean {
    const hit = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return hit;
  }

  flush(): void {
    this.pressedOnce.clear();
  }
}
