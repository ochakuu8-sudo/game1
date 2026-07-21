import { Container, Sprite } from "pixi.js";
import type Matter from "matter-js";
import type { Atlas } from "../core/atlas";
import { buildingRect, type BuildingSlot } from "../physics/layout";
import type { BuildingType } from "./buildingTypes";

const HIT_FLASH_TIME = 0.22;

export class Building {
  container: Container;
  private sprite: Sprite;
  private normalTexture: Sprite["texture"];
  private dizzyTexture: Sprite["texture"];
  private digitTens: Sprite;
  private digitOnes: Sprite;
  private digitSpacing: number;
  private atlas: Atlas;
  private cellCount: number;
  /** The building type this whole city generation was built as - fixed for
   * this instance's lifetime; a different pick rebuilds the entire grid
   * with fresh Building instances instead (see Game.rebuildCity). */
  readonly type: BuildingType;
  /** Duration `rebuildTimer` was set to at the last destruction - used to
   * compute the collapse animation's progress independent of how long
   * this particular type's cooldown actually is. */
  private rebuildDuration = 0;
  slot: BuildingSlot;
  body: Matter.Body;

  hp = 0;
  maxHp = 0;
  destroyed = false;
  rebuildTimer = 0;
  hitFlash = 0;
  level = 0;
  /** Counts down to this building's very first appearance. Non-null only
   * before it has ever spawned - a separate concept from `rebuildTimer`
   * (which recovers a *destroyed* building) since a not-yet-built lot can
   * sit dormant far longer than the short post-destruction animation
   * window that timer's math assumes. */
  private pendingSpawnTimer: number | null = null;

  constructor(atlas: Atlas, slot: BuildingSlot, body: Matter.Body, type: BuildingType) {
    this.atlas = atlas;
    this.slot = slot;
    this.body = body;
    this.type = type;
    this.cellCount = slot.spanCols * slot.spanRows;

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

    // Starts fully dormant (invisible, no body in the physics world) - the
    // game decides per-instance whether to spawn it immediately or on a
    // delay via spawn()/scheduleSpawn().
    this.destroyed = true;
    this.container.visible = false;
    this.container.alpha = 0;
  }

  /** Arrange for this lot's first building to appear after `delay` seconds
   * instead of immediately - used to trickle the city in over time rather
   * than starting with every lot already built. A full reset (not just
   * setting the timer) since this can be called on a building that's
   * currently active - e.g. re-rolling which lots start built on a restart
   * - and must fully hide/deactivate it, not just queue a future respawn
   * on top of whatever state it was already in. */
  scheduleSpawn(delay: number) {
    this.pendingSpawnTimer = delay;
    this.destroyed = true;
    this.hp = 0;
    this.maxHp = 0;
    this.hitFlash = 0;
    this.rebuildTimer = 0;
    this.container.visible = false;
    this.container.alpha = 0;
  }

  spawn(level: number) {
    // Clear any leftover dormant countdown - without this, a building
    // spawned while one was still ticking (e.g. picked as a starter again
    // on a restart, after previously being scheduled to appear later) has
    // update() keep hitting its early-return branch for that stale timer
    // forever, which silently skips the hitFlash/collapse-animation code
    // below entirely - a destroyed building would register hp 0 correctly
    // but its sprite would just sit there fully visible, never shrinking
    // away or freeing up for its own rebuild.
    this.pendingSpawnTimer = null;
    this.level = level;
    // A freshly-spawned level-1 lot starts near its type's base HP - a
    // handful of hits down. Higher rebuild levels and a bigger physical
    // footprint both make it tougher.
    this.maxHp = Math.max(1, Math.min(this.type.hpBase + (level - 1) * this.type.hpPerLevel + (this.cellCount - 1) * 2, 20));
    this.hp = this.maxHp;
    this.destroyed = false;
    this.rebuildTimer = 0;
    this.container.visible = true;
    this.container.scale.set(1);
    this.container.alpha = 1;
    this.sprite.texture = this.normalTexture;
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
      this.rebuildDuration = this.type.spawnCooldown;
      this.rebuildTimer = this.rebuildDuration;
      return true;
    }
    return false;
  }

  update(dt: number): "rebuilt" | null {
    if (this.pendingSpawnTimer !== null) {
      this.pendingSpawnTimer -= dt;
      if (this.pendingSpawnTimer <= 0) {
        this.pendingSpawnTimer = null;
        this.spawn(1);
        return "rebuilt";
      }
      return null;
    }

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
      const collapseT = Math.min(1, (this.rebuildDuration - this.rebuildTimer) / 0.5);
      this.container.scale.set(Math.max(0.05, 1 - collapseT));
      this.container.alpha = 1 - collapseT * 0.9;
      // Once the shrink is done, hide it outright instead of leaving a
      // faint 10%-alpha speck sitting in the lot for the rest of the
      // rebuild wait - a cleared building should read as gone, not as a
      // lingering 0-HP ghost.
      if (collapseT >= 1) this.container.visible = false;
      if (this.rebuildTimer <= 0) {
        this.spawn(this.level + 1);
        return "rebuilt";
      }
    }
    return null;
  }
}
