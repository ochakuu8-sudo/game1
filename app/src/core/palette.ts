// A small, NES/Famicom-style limited colour set shared by every drawing
// routine (atlas.ts, tableVisuals.ts, game.ts's backdrop, hud.ts,
// powerupSelect.ts) so the whole game reads as one cohesive retro cartridge
// instead of each screen picking its own palette.
export const PALETTE = {
  void: 0x0f0f1e,
  ink: 0x10101c,
  paper: 0xf8f8f0,

  sky: 0x5c94fc,
  skyDeep: 0x2038c8,
  street: 0x5c5c78,
  streetLine: 0x8888a8,

  red: 0xd82800,
  orange: 0xf87858,
  gold: 0xf8b800,
  yellow: 0xf8d878,
  green: 0x00a844,
  mint: 0x58d878,
  blue: 0x3cbcfc,
  navy: 0x0058f8,
  purple: 0x9878f8,
  pink: 0xf878b8,
} as const;
