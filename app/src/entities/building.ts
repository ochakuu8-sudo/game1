import { Container, Sprite } from "pixi.js";
import type Matter from "matter-js";
import type { Atlas } from "../core/atlas";
import { buildingRect, type BuildingSlot } from "../physics/layout";
import { buildingMaxHp, type BuildingType } from "./buildingTypes";

const HIT_FLASH_TIME = 0.22;
const COLLAPSE_TIME = 0.5;

/** One physical lot on the board - created fresh by a spawner (see
 * Game.trySpawnBuilding) already spawned and ready, and permanently gone
 * once destroyed (no self-rebuild) - it's up to whichever spawner ticks
 * next to place a brand new lot into the space that frees up. */
export class Building {
  container: Container;
  private sprite: Sprite;
  private normalTexture: Sprite["texture"];
  private dizzyTexture: Sprite["texture"];
  private digitTens: Sprite;
  private digitOnes: Sprite;
  private digitSpacing: number;
  private atlas: Atlas;
  readonly type: BuildingType;
  private collapseT = 0;
  private removed = false;
  slot: BuildingSlot;
  body: Matter.Body;

  hp = 0;
  maxHp = 0;
  destroyed = false;
  hitFlash = 0;

  constructor(atlas: Atlas, slot: BuildingSlot, body: Matter.Body, type: BuildingType) {
    this.atlas = atlas;
    this.slot = slot;
    this.body = body;
    this.type = type;

    const rect = buildingRect(slot);
    this.normalTexture = atlas.buildings[type.id];
    this.dizzyTexture = atlas.buildingsDizzy[type.id];

    this.container = new Container();
    this.container.position.set(rect.x, rect.y);

    const shadow = new Sprite(this.normalTexture);
    shadow.anchor.set(0.5);
    shadow.tint = 0x101820;
    shadow.alpha = 0.28;
    shadow.position.set(4, 6);
    this.container.addChild(shadow);

    this.sprite = new Sprite(this.normalTexture);
    this.sprite.anchor.set(0.5);
    this.container.addChild(this.sprite);

    // Scale the HP digits with the building's own footprint, capped small
    // enough that the number reads clearly without blotting out the whole
    // tiny facade underneath (windows/face/tint).
    const digitScale = Math.min(0.3, Math.max(0.16, rect.width / 90));
    this.digitSpacing = 13 * (digitScale / 0.42);
    // Centered on the facade itself (covering the face is fine) instead of
    // floating above it, so the HP reads as part of the building.
    const digitY = 0;
    this.digitTens = new Sprite(atlas.digits[0]);
    this.digitTens.anchor.set(0.5);
    this.digitTens.scale.set(digitScale);
    this.digitTens.position.set(-this.digitSpacing, digitY);
    this.digitOnes = new Sprite(atlas.digits[0]);
    this.digitOnes.anchor.set(0.5);
    this.digitOnes.scale.set(digitScale);
    this.digitOnes.position.set(this.digitSpacing, digitY);
    this.container.addChild(this.digitTens, this.digitOnes);

    this.maxHp = buildingMaxHp(type);
    this.hp = this.maxHp;
    this.refreshDigits();
  }

  private refreshDigits() {
    const tens = Math.floor(this.hp / 10);
    const ones = this.hp % 10;
    this.digitTens.visible = tens > 0;
    if (tens > 0) this.digitTens.texture = this.atlas.digits[tens];
    this.digitOnes.texture = this.atlas.digits[ones];
    this.digitOnes.position.x = tens > 0 ? this.digitSpacing : 0;
  }

  /** Register a ball impact. Returns true the instant it drops to 0 HP. */
  hit(): boolean {
    if (this.destroyed || this.hp <= 0) return false;
    this.hp--;
    this.hitFlash = HIT_FLASH_TIME;
    this.sprite.texture = this.dizzyTexture;
    this.refreshDigits();
    if (this.hp <= 0) {
      this.destroyed = true;
      this.collapseT = 0;
      return true;
    }
    return false;
  }

  /** Returns "removed" the instant the post-destruction collapse
   * animation finishes - Game then tears down this lot's body/container
   * for good (see Game.tick). Only ever fires once per instance. */
  update(dt: number): "removed" | null {
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const f = Math.max(0, this.hitFlash / HIT_FLASH_TIME);
      // Cartoon "boing" squash: widen then settle, rather than a plain
      // uniform scale bump - reads much more like a bouncy impact.
      const squish = Math.sin(f * Math.PI) * f;
      this.container.scale.set(1 + squish * 0.16, 1 - squish * 0.14);
      if (this.hitFlash <= 0) this.sprite.texture = this.normalTexture;
    } else if (!this.destroyed) {
      this.container.scale.set(1, 1);
    }

    if (this.destroyed) {
      this.collapseT = Math.min(1, this.collapseT + dt / COLLAPSE_TIME);
      this.container.scale.set(Math.max(0.05, 1 - this.collapseT));
      this.container.alpha = 1 - this.collapseT * 0.9;
      if (this.collapseT >= 1 && !this.removed) {
        this.removed = true;
        return "removed";
      }
    }
    return null;
  }
}
