import { describe, expect, it } from 'vitest';
import { Bot } from '../src/game/bot';
import { World } from '../src/game/world';

describe('bot', () => {
  it('two bots finish a match on the course', () => {
    const w = new World();
    const bots = [new Bot(0), new Bot(1)];
    const h = 1 / 60;
    let t = 0;
    while (w.winner === null && t < 240) {
      const inputs = bots.map((b) => b.think(w, h));
      w.advance(h, inputs);
      w.drainEvents();
      t += h;
    }
    expect(w.winner).not.toBeNull();
    const strokes = w.rats.map((r) => r.strokes);
    console.log(`winner ${w.winner} after ${t.toFixed(1)} s, strokes ${strokes}`);
    expect(t).toBeLessThan(240);
  }, 60000);
});
