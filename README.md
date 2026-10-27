# Podgolf

Two rats, two golf balls, one drain. A split-screen, two-player golf prototype rendered with raw
WebGPU: each rat smacks its own ball with its snout across a night-time kitchen floor, and the first
ball down the drain wins.

**Play:** https://zigagobec.github.io/podgolf/ (needs a WebGPU browser: desktop Chrome/Edge,
Android Chrome, Safari 26+).

| | Rat 1 (Sirko) | Rat 2 (Mrvica) |
|---|---|---|
| walk / turn | `W A S D` | arrow keys |
| charge & lunge | hold / release `Space` | hold / release `Enter` |

Gamepads work too (pad 1 → Sirko, pad 2 → Mrvica). `B` on the title screen hands Mrvica to the
computer. `M` mutes, `N` toggles the music, `Esc` pauses.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics tests (ball, hole, rats, ramps)
npm run build
```

- `src/game/` — course layout, physics world (balls, rats, drain), chase cameras, bot
- `src/physics/` — sphere vs box / cylinder / capsule contacts
- `src/render/` — WebGPU renderer: shadow map → MSAA split-screen pass → bloom → ink-outline composite
- `src/audio/` — every sound and the music loop are synthesized with WebAudio; there are no asset files
- `tools/shot.mjs` — headless screenshot using `chromium-headless-shell` with SwiftShader WebGPU flags
