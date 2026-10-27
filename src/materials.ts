/** Material ids shared by the course description and the WGSL shader (keep in sync with scene.wgsl). */
export const MAT = {
  plain: 0,
  tiles: 1,
  wood: 2,
  can: 3,
  cheese: 4,
  sponge: 5,
  fur: 6,
  ball: 7,
  cardboard: 8,
  glow: 9,
  drain: 10,
  cabinet: 11,
  cup: 12,
  bread: 13,
  milk: 14,
  wall: 15,
  fridge: 16,
  skin: 17,
  eye: 18,
  metal: 19,
} as const;

export type Look = { mat: number; color: [number, number, number]; param?: number };

export const PLAYER_COLORS: [number, number, number][] = [
  [0.95, 0.32, 0.18],
  [0.2, 0.62, 0.98],
];
export const PLAYER_NAMES = ['Sirko', 'Mrvica'];
export const PLAYER_CSS = ['#ff6a3d', '#3fa9ff'];
