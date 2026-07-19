import { Container, Sprite } from "pixi.js";
import type Matter from "matter-js";
import type { Atlas } from "../core/atlas";
import type { BuildingSlot } from "../physics/layout";

const COLLAPSE_TIME = 0.5;
const HIT_FLASH_TIME = 0.12;

export class Building {
  container: Container;
  private sprite: Sprite;
  private digitTens: Sprite;
  private digitOnes: Sprite;
  private atlas: Atlas;
  slot: BuildingSlot;
  body: Matter.Body;

  hp = 0;
  maxHp = 0;
  destroyed = false;
  collapseT = 0;
  hitFlash = 0;
  level = 0;

  constructor(atlas: Atlas, slot: BuildingSlot, body: Matter.Body) {
    this.atlas = atlas;
    this.slot = slot;
    this.body = body;

    this.container = new Container();
    this.container.position.set(slot.x, slot.y);

    this.sprite = new Sprite(slot.variant === "wide" ? atlas.buildingWide : atlas.buildingTower);
    this.sprite.anchor.set(0.5);
    this.container.addChild(this.sprite);

    const digitY = slot.variant === "wide" ? -46 : -62;
    this.digitTens = new Sprite(atlas.digits[0]);
    this.digitTens.anchor.set(0.5);
    this.digitTens.scale.set(0.42);
    this.digitTens.position.set(-13, digitY);
    this.digitOnes = new Sprite(atlas.digits[0]);
    this.digitOnes.anchor.set(0.5);
    this.digitOnes.scale.set(0.42);
    this.digitOnes.position.set(13, digitY);
    this.container.addChild(this.digitTens, this.digitOnes);

    this.spawn(3);
  }

  /** (Re)spawns this building at the given difficulty level, e.g. at floor start. */
  spawn(level: number) {
    this.level = level;
    this.maxHp = Math.min(3 + level, 16);
    this.hp = this.maxHp;
    this.destroyed = false;
    this.collapseT = 0;
    this.container.visible = true;
    this.container.scale.set(1);
    this.container.alpha = 1;
    this.refreshDigits();
  }

  private refreshDigits() {
    const tens = Math.floor(this.hp / 10);
    const ones = this.hp % 10;
    this.digitTens.visible = tens > 0;
    if (tens > 0) this.digitTens.texture = this.atlas.digits[tens];
    this.digitOnes.texture = this.atlas.digits[ones];
    this.digitOnes.position.x = tens > 0 ? 13 : 0;
  }

  /** Register a ball impact. Returns true the instant it drops to 0 HP. */
  hit(): boolean {
    if (this.destroyed || this.hp <= 0) return false;
    this.hp--;
    this.hitFlash = HIT_FLASH_TIME;
    this.refreshDigits();
    if (this.hp <= 0) {
      this.destroyed = true;
      this.collapseT = 0;
      return true;
    }
    return false;
  }

  update(dt: number) {
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const f = Math.max(0, this.hitFlash / HIT_FLASH_TIME);
      if (!this.destroyed) this.container.scale.set(1 + f * 0.08);
    } else if (!this.destroyed) {
      this.container.scale.set(1);
    }

    // Once destroyed the building stays collapsed (rubble) until the game
    // explicitly calls spawn() again for the next floor - there is no
    // automatic rebuild timer anymore.
    if (this.destroyed && this.collapseT < COLLAPSE_TIME) {
      this.collapseT = Math.min(COLLAPSE_TIME, this.collapseT + dt);
      const t = this.collapseT / COLLAPSE_TIME;
      this.container.scale.set(Math.max(0.05, 1 - t));
      this.container.alpha = 1 - t * 0.9;
    }
  }
}
