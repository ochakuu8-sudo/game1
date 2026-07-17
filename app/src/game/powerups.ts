export type PowerUpType = "FLIPPER" | "MAGNET" | "MULTIPLIER" | "EXTRA_BALL" | "KICK";

export interface PowerUpChoice {
  type: PowerUpType;
  label: string;
}

const POOL: PowerUpChoice[] = [
  { type: "FLIPPER", label: "フリッパー強化" },
  { type: "MAGNET", label: "キャッチ範囲UP" },
  { type: "MULTIPLIER", label: "スコア倍率UP" },
  { type: "EXTRA_BALL", label: "エクストラボール" },
  { type: "KICK", label: "キック力UP" },
];

const MAX_STACKS = 6;

/** Tracks the permanent buffs the player has accumulated this run. */
export class PowerUpManager {
  stacks: Record<PowerUpType, number> = {
    FLIPPER: 0,
    MAGNET: 0,
    MULTIPLIER: 0,
    EXTRA_BALL: 0,
    KICK: 0,
  };

  get catchRadiusBonus(): number {
    return this.stacks.MAGNET * 6;
  }

  get scoreMultiplier(): number {
    return 1 + this.stacks.MULTIPLIER * 0.25;
  }

  get kickForceMultiplier(): number {
    return 1 + this.stacks.KICK * 0.15;
  }

  get flipperPowerMultiplier(): number {
    return 1 + this.stacks.FLIPPER * 0.12;
  }

  /** Picks a random buff to grant, weighted away from already-maxed stacks. */
  grantRandom(): PowerUpChoice {
    const candidates = POOL.filter((p) => this.stacks[p.type] < MAX_STACKS);
    const pool = candidates.length > 0 ? candidates : POOL;
    const choice = pool[(Math.random() * pool.length) | 0];
    this.stacks[choice.type]++;
    return choice;
  }
}
