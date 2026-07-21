import { PALETTE } from "../core/palette";

/**
 * A "blueprint" a house lot can be built from. The player picks one of
 * these via a card (see game/buildingSelect.ts) roughly as often as a
 * power-up card, and it becomes `Game.currentBuildingType` - every lot
 * that spawns or rebuilds from that point on uses it, until the player
 * picks a different one. Slot positions/count and the physics footprint
 * are unchanged; only these gameplay numbers vary between types.
 */
export interface BuildingType {
  id: string;
  label: string;
  description: string;
  color: number;
  /** Score awarded when a lot of this type is destroyed. */
  score: number;
  /** Score awarded on a hit that doesn't destroy it. */
  hitScore: number;
  /** Seconds between destruction and rebuilding. */
  spawnCooldown: number;
  /** Range of humans spawned when destroyed. */
  humanMin: number;
  humanMax: number;
  /** Virtual lot size feeding the HP formula (bigger = tougher) - flavour
   * only, doesn't change the physical grid footprint. */
  cellUnits: number;
  hpBase: number;
  hpPerLevel: number;
}

export const BUILDING_TYPES: BuildingType[] = [
  {
    id: "flat",
    label: "平屋",
    description: "安くてすぐ建つ小さな家",
    color: PALETTE.mint,
    score: 70,
    hitScore: 5,
    spawnCooldown: 2.5,
    humanMin: 1,
    humanMax: 2,
    cellUnits: 1,
    hpBase: 1,
    hpPerLevel: 1,
  },
  {
    id: "standard",
    label: "一軒家",
    description: "バランスの取れた標準的な家",
    color: PALETTE.blue,
    score: 150,
    hitScore: 10,
    spawnCooldown: 5.5,
    humanMin: 3,
    humanMax: 6,
    cellUnits: 2,
    hpBase: 1,
    hpPerLevel: 1,
  },
  {
    id: "apartment",
    label: "アパート",
    description: "住人が多く、そこそこ頑丈",
    color: PALETTE.gold,
    score: 220,
    hitScore: 12,
    spawnCooldown: 6.5,
    humanMin: 6,
    humanMax: 10,
    cellUnits: 3,
    hpBase: 2,
    hpPerLevel: 1,
  },
  {
    id: "mansion",
    label: "豪邸",
    description: "頑丈で高得点、再建は遅め",
    color: PALETTE.orange,
    score: 420,
    hitScore: 20,
    spawnCooldown: 9.5,
    humanMin: 4,
    humanMax: 8,
    cellUnits: 4,
    hpBase: 3,
    hpPerLevel: 2,
  },
  {
    id: "tower",
    label: "タワマン",
    description: "超高得点・大人数だが再建が非常に遅い",
    color: PALETTE.purple,
    score: 700,
    hitScore: 30,
    spawnCooldown: 13,
    humanMin: 10,
    humanMax: 16,
    cellUnits: 6,
    hpBase: 4,
    hpPerLevel: 3,
  },
];

/** The type new lots use before the player has picked one yet. */
export const DEFAULT_BUILDING_TYPE = BUILDING_TYPES[1];

/** Offers `count` distinct random building types to choose from. */
export function pickBuildingChoices(count = 3): BuildingType[] {
  const shuffled = [...BUILDING_TYPES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
