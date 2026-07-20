export type PowerUpType = "FLIPPER" | "MAGNET" | "MULTIPLIER" | "EXTRA_BALL" | "KICK";

export interface PowerUpChoice {
  type: PowerUpType;
  label: string;
  description: string;
  color: number;
}

const POOL: PowerUpChoice[] = [
  { type: "FLIPPER", label: "フリッパー強化", description: "打ち返しが強くなる", color: 0xff5a3c },
  { type: "MAGNET", label: "キャッチ範囲UP", description: "人間を捕まえる範囲が広がる", color: 0xb2e0ff },
  { type: "MULTIPLIER", label: "スコア倍率UP", description: "獲得スコアが増える", color: 0xffe066 },
  { type: "EXTRA_BALL", label: "エクストラボール", description: "ボールが1個増える", color: 0xc9ffb2 },
  { type: "KICK", label: "キック力UP", description: "ビル衝突の跳ね返りが強くなる", color: 0xffb2d0 },
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

  /** Offers up to `count` distinct not-yet-maxed choices for the player to pick from. */
  grantChoices(count = 3): PowerUpChoice[] {
    const available = POOL.filter((p) => this.stacks[p.type] < MAX_STACKS);
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /** Applies the player's chosen buff, respecting the per-type stack cap. */
  applyChoice(type: PowerUpType) {
    if (this.stacks[type] < MAX_STACKS) this.stacks[type]++;
  }
}
