import { GRID_COLS, GRID_ROWS, type BuildingSlot } from "../physics/layout";

/**
 * A "blueprint" the city generates lots from. The player picks one of
 * these via a card (see game/buildingSelect.ts) at the start of every
 * stage, and it's added to `Game.buildingPool` - a running multiset of
 * every type picked so far (see Game.rebuildCity). Picking the same type
 * again doesn't replace anything, it just adds another entry to the pool,
 * making that type more likely to come up when the grid is retiled (see
 * `tileWeightedCity` below). Each type also gets its own fixed-size facade
 * artwork (see core/atlas.ts's per-type draw functions) instead of a
 * shared shape.
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

/** Offers `count` distinct random building types to choose from - not
 * filtered against what's already in the pool, since picking a type
 * that's already there (to weight it up further) is the whole point. */
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

export interface CityLot {
  slot: BuildingSlot;
  type: BuildingType;
}

/** Tiles the grid from a weighted pool of building types - `pool` is a
 * running multiset (see Game.buildingPool), so a type picked twice has
 * two entries and is twice as likely to win a cell as one picked once,
 * without ever crowding out types picked earlier. Scans the grid cell by
 * cell; at each still-free cell it weighted-randomly picks among whichever
 * pool entries actually fit there (footprint inside the grid bounds, every
 * cell it would cover still free), and leaves the cell as bare street if
 * nothing in the pool fits. */
export function tileWeightedCity(pool: BuildingType[]): CityLot[] {
  if (pool.length === 0) return [];
  const occupied: boolean[][] = Array.from({ length: GRID_ROWS }, () => Array<boolean>(GRID_COLS).fill(false));
  const lots: CityLot[] = [];

  const fits = (col: number, row: number, type: BuildingType): boolean => {
    if (col + type.spanCols > GRID_COLS || row + type.spanRows > GRID_ROWS) return false;
    for (let r = row; r < row + type.spanRows; r++) {
      for (let c = col; c < col + type.spanCols; c++) {
        if (occupied[r][c]) return false;
      }
    }
    return true;
  };

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (occupied[row][col]) continue;
      const candidates = pool.filter((t) => fits(col, row, t));
      if (candidates.length === 0) continue;
      const type = candidates[Math.floor(Math.random() * candidates.length)];
      for (let r = row; r < row + type.spanRows; r++) {
        for (let c = col; c < col + type.spanCols; c++) {
          occupied[r][c] = true;
        }
      }
      lots.push({ slot: { col, row, spanCols: type.spanCols, spanRows: type.spanRows }, type });
    }
  }
  return lots;
}
