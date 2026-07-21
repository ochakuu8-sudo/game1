import { GRID_COLS, GRID_ROWS, type BuildingSlot } from "../physics/layout";

/**
 * A "blueprint" a spawner generates lots from. The player picks one of
 * these via a card (see game/buildingSelect.ts) at the start of every
 * stage, and it spins up an independent spawner (see Game.spawners) that
 * repeats forever on its own cooldown: every `spawnCooldown` seconds it
 * tries to drop one new lot of this type into any free spot on the grid,
 * regardless of whether earlier lots from it have been destroyed yet.
 * Picking the same type again doesn't touch the first spawner - it starts
 * a second one running in parallel, so two picks of the same type means
 * roughly twice the appearance rate for it. Each type also gets its own
 * fixed-size facade artwork (see core/atlas.ts's per-type draw functions)
 * instead of a shared shape.
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
  /** Seconds between this type's spawner attempts - see Game.spawners. */
  spawnCooldown: number;
  /** Range of humans spawned when destroyed. */
  humanMin: number;
  humanMax: number;
  hpBase: number;
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
  },
];

/** Offers `count` distinct random building types to choose from - not
 * filtered against what's already running a spawner, since picking a type
 * that already has one (to start a second, parallel spawner for it) is
 * the whole point. */
export function pickBuildingChoices(count = 3): BuildingType[] {
  const shuffled = [...BUILDING_TYPES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/** A lot's fixed max HP - bigger footprints are tougher. Every lot of a
 * given type is identical (no more per-rebuild growth), since lots are now
 * one-shot: destroyed means gone, and a future spawner tick creates a
 * fresh instance rather than this same one coming back stronger. */
export function buildingMaxHp(type: BuildingType): number {
  const cellCount = type.spanCols * type.spanRows;
  return Math.max(1, Math.min(type.hpBase + (cellCount - 1) * 2, 20));
}

/** Compact stat lines for the building-select card - see game/cardSelect.ts. */
export function buildingStatLines(type: BuildingType): string[] {
  return [
    `HP${buildingMaxHp(type)} / ${type.spanCols}×${type.spanRows}マス`,
    `破壊${type.score}点 被弾${type.hitScore}点`,
    `再建${type.spawnCooldown}秒 人間${type.humanMin}〜${type.humanMax}人`,
  ];
}

/** Finds a free spot on the grid for `type`'s footprint, given the slots
 * already occupied by every lot currently on the board (`existing`) - used
 * by a spawner (see Game.trySpawnBuilding) each time its cooldown fires.
 * Candidate positions are shuffled so repeated spawns don't always pack
 * into the same corner. Returns null if nothing fits (board full for that
 * footprint) - the spawner just tries again on its next cooldown. */
export function findFreeSlot(type: BuildingType, existing: BuildingSlot[]): BuildingSlot | null {
  const occupied: boolean[][] = Array.from({ length: GRID_ROWS }, () => Array<boolean>(GRID_COLS).fill(false));
  for (const s of existing) {
    for (let r = s.row; r < s.row + s.spanRows; r++) {
      for (let c = s.col; c < s.col + s.spanCols; c++) {
        occupied[r][c] = true;
      }
    }
  }

  const fits = (col: number, row: number): boolean => {
    if (col + type.spanCols > GRID_COLS || row + type.spanRows > GRID_ROWS) return false;
    for (let r = row; r < row + type.spanRows; r++) {
      for (let c = col; c < col + type.spanCols; c++) {
        if (occupied[r][c]) return false;
      }
    }
    return true;
  };

  const positions: Array<{ col: number; row: number }> = [];
  for (let row = 0; row + type.spanRows <= GRID_ROWS; row++) {
    for (let col = 0; col + type.spanCols <= GRID_COLS; col++) {
      positions.push({ col, row });
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  for (const p of positions) {
    if (fits(p.col, p.row)) {
      return { col: p.col, row: p.row, spanCols: type.spanCols, spanRows: type.spanRows };
    }
  }
  return null;
}
