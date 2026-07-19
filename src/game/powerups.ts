export type PowerUpType = "FLIPPER" | "MAGNET" | "MULTIPLIER" | "EXTRA_BALL" | "KICK" | "CHAIN" | "SALVAGE";

export interface PowerUpChoice {
  type: PowerUpType;
  label: string;
  desc: string;
}

export type KaijuClass = "FIRE" | "ELECTRIC" | "HEAVY";

export interface KaijuClassInfo {
  type: KaijuClass;
  label: string;
  desc: string;
}

export const CLASS_POOL: KaijuClassInfo[] = [
  { type: "FIRE", label: "炎かいじゅう", desc: "キック力+30%からスタート。建物破壊特化。" },
  { type: "ELECTRIC", label: "電撃かいじゅう", desc: "キャッチ範囲UPからスタート。人間コンボ特化。" },
  { type: "HEAVY", label: "重量かいじゅう", desc: "フリッパー威力UPからスタート。安定した打ち返し特化。" },
];

const POOL: PowerUpChoice[] = [
  { type: "FLIPPER", label: "フリッパー強化", desc: "フリッパーの反発力が上がる" },
  { type: "MAGNET", label: "キャッチ範囲UP", desc: "人間を踏み潰せる範囲が広がる" },
  { type: "MULTIPLIER", label: "スコア倍率UP", desc: "全スコア獲得量が増える" },
  { type: "EXTRA_BALL", label: "エクストラボール", desc: "持ち球が即座に1個増える" },
  { type: "KICK", label: "キック力UP", desc: "建物ヒット時の跳ね返りが強くなる" },
  { type: "CHAIN", label: "連鎖ショック", desc: "人間を踏み潰すと周囲の人間も巻き込む" },
  { type: "SALVAGE", label: "サルベージ", desc: "建物破壊時、確率で持ち球が1個戻る" },
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
    CHAIN: 0,
    SALVAGE: 0,
  };
  kaijuClass: KaijuClass | null = null;

  /** Applies the run-starting bonus for the chosen kaiju class. */
  applyClass(cls: KaijuClass) {
    this.kaijuClass = cls;
    if (cls === "FIRE") this.stacks.KICK += 2;
    else if (cls === "ELECTRIC") this.stacks.MAGNET += 2;
    else if (cls === "HEAVY") this.stacks.FLIPPER += 2;
  }

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

  /** Radius (px) for the chain-reaction human pop; 0 when not stacked. */
  get chainRadius(): number {
    return this.stacks.CHAIN > 0 ? 40 + this.stacks.CHAIN * 14 : 0;
  }

  /** Chance a destroyed building refunds a ball to the reserve. */
  get salvageChance(): number {
    return Math.min(0.6, this.stacks.SALVAGE * 0.08);
  }

  /** Draws N distinct relic choices for the floor-clear reward screen. */
  offerChoices(count = 3): PowerUpChoice[] {
    const shuffled = [...POOL].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  apply(choice: PowerUpChoice) {
    this.stacks[choice.type] = Math.min(MAX_STACKS, this.stacks[choice.type] + 1);
  }
}
