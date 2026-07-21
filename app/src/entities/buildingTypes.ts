/**
 * A "blueprint" the whole city rebuilds from. The player picks one of
 * these via a card (see game/buildingSelect.ts) at the start of every
 * stage, and it becomes `Game.currentBuildingType` - the entire grid is
 * regenerated to that type's fixed lot size and every lot on the board is
 * that type (see Game.rebuildCity) until the player picks a different one
 * at the next stage. Each type also gets its own facade artwork (see
 * core/atlas.ts's per-type draw functions) instead of a shared shape.
 */
export interface BuildingType {
  id: string;
  label: string;
  description: string;
  /** Facade base colour (and card accent colour). */
  color: number;
  /** Fixed grid footprint - both the physics collider size and the whole
   * city's lot size while this type is active. */
  spanCols: number;
  spanRows: number;
  /** Score awarded when a lot of this type is destroyed. */
  score: number;
  /** Score awarded on a hit that doesn't destroy it. */
  hitScore: number;
  /** Seconds between destruction and rebuilding. */
  spawnCooldown: number;
  /** Range of humans spawned when destroyed. */
  humanMin: number;
  humanMax: number;
  hpBase: number;
  hpPerLevel: number;
}

export const BUILDING_TYPES: BuildingType[] = [
  {
    id: "flat",
    label: "平屋",
    description: "安くてすぐ建つ小さな平屋",
    color: 0xd9c7a3, // sandy stucco
    spanCols: 1,
    spanRows: 1,
    score: 70,
    hitScore: 5,
    spawnCooldown: 2.5,
    humanMin: 1,
    humanMax: 2,
    hpBase: 1,
    hpPerLevel: 1,
  },
  {
    id: "standard",
    label: "一軒家",
    description: "バランスの取れた標準的な一戸建て",
    color: 0xc07a58, // brick red
    spanCols: 1,
    spanRows: 1,
    score: 150,
    hitScore: 10,
    spawnCooldown: 5.5,
    humanMin: 3,
    humanMax: 6,
    hpBase: 2,
    hpPerLevel: 1,
  },
  {
    id: "apartment",
    label: "アパート",
    description: "住人が多く、そこそこ頑丈な集合住宅",
    color: 0xa9a294, // concrete
    spanCols: 1,
    spanRows: 2,
    score: 220,
    hitScore: 12,
    spawnCooldown: 6.5,
    humanMin: 6,
    humanMax: 10,
    hpBase: 3,
    hpPerLevel: 1,
  },
  {
    id: "mansion",
    label: "豪邸",
    description: "頑丈で高得点、再建は遅めの大邸宅",
    color: 0xe9e2ce, // cream stucco
    spanCols: 2,
    spanRows: 2,
    score: 420,
    hitScore: 20,
    spawnCooldown: 9.5,
    humanMin: 4,
    humanMax: 8,
    hpBase: 5,
    hpPerLevel: 2,
  },
  {
    id: "tower",
    label: "タワマン",
    description: "超高得点・大人数だが再建が非常に遅い高層マンション",
    color: 0x7d93a8, // glass/steel blue
    spanCols: 2,
    spanRows: 3,
    score: 700,
    hitScore: 30,
    spawnCooldown: 13,
    humanMin: 10,
    humanMax: 16,
    hpBase: 8,
    hpPerLevel: 3,
  },
];

/** The type the board uses before the player has ever picked one. */
export const DEFAULT_BUILDING_TYPE = BUILDING_TYPES[1];

/** Offers `count` distinct random building types to choose from. */
export function pickBuildingChoices(count = 3): BuildingType[] {
  const shuffled = [...BUILDING_TYPES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/** Compact stat lines for the building-select card - see game/cardSelect.ts. */
export function buildingStatLines(type: BuildingType): string[] {
  return [
    `HP${type.hpBase}〜 / ${type.spanCols}×${type.spanRows}マス`,
    `破壊${type.score}点 被弾${type.hitScore}点`,
    `再建${type.spawnCooldown}秒 人間${type.humanMin}〜${type.humanMax}人`,
  ];
}
