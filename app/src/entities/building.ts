import { Container, Sprite } from "pixi.js";
import type Matter from "matter-js";
import { buildingSizeKey, type Atlas } from "../core/atlas";
import { buildingRect, type BuildingSlot } from "../physics/layout";

const REBUILD_TIME = 5.5;
const HIT_FLASH_TIME = 0.22;

// Cute pastel facade tints - each building instance picks one so the same
// handful of baked textures (one per footprint size) still reads as a
// varied, candy-coloured city block rather than identical copies.
const TINTS = [0xffb3c6, 0xa8e0c8, 0xffd9a0, 0xb3d4ff, 0xd9b8f0, 0xfff0a8];

export class Building {
  container: Container;
  private sprite: Sprite;
  private normalTexture: Sprite["texture"];
  private dizzyTexture: Sprite["texture"];
  private digitTens: Sprite;
  private digitOnes: Sprite;
  private atlas: Atlas;
  private baseTint: number;
  private cellCount: number;
  slot: BuildingSlot;
  body: Matter.Body;

  hp = 0;
  maxHp = 0;
  destroyed = false;
  rebuildTimer = 0;
  hitFlash = 0;
  level = 0;

  constructor(atlas: Atlas, slot: BuildingSlot, body: Matter.Body) {
    this.atlas = atlas;
    this.slot = slot;
    this.body = body;
    this.cellCount = slot.spanCols * slot.spanRows;

    const rect = buildingRect(slot);
    this.baseTint = TINTS[(Math.random() * TINTS.length) | 0];
    const key = buildingSizeKey(rect.width, rect.height);
    this.normalTexture = atlas.buildings[key];
    this.dizzyTexture = atlas.buildingsDizzy[key];

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
    this.sprite.tint = this.baseTint;
    this.container.addChild(this.sprite);

    const digitY = -rect.height / 2 - 14;
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

  spawn(level: number) {
    this.level = level;
    // Bigger footprints (a 2x2 block vs a 1x1) take more hits to clear.
    this.maxHp = Math.min(3 + level + (this.cellCount - 1) * 2, 20);
    this.hp = this.maxHp;
    this.destroyed = false;
    this.rebuildTimer = 0;
    this.container.visible = true;
    this.container.scale.set(1);
    this.container.alpha = 1;
    this.sprite.tint = this.baseTint;
    this.sprite.texture = this.normalTexture;
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
    this.sprite.texture = this.dizzyTexture;
    this.refreshDigits();
    if (this.hp <= 0) {
      this.destroyed = true;
      this.rebuildTimer = REBUILD_TIME;
      return true;
    }
    return false;
  }

  update(dt: number): "rebuilt" | null {
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
      this.rebuildTimer -= dt;
      const collapseT = Math.min(1, (REBUILD_TIME - this.rebuildTimer) / 0.5);
      this.container.scale.set(Math.max(0.05, 1 - collapseT));
      this.container.alpha = 1 - collapseT * 0.9;
      if (this.rebuildTimer <= 0) {
        this.spawn(this.level + 1);
        return "rebuilt";
      }
    }
    return null;
  }
}
