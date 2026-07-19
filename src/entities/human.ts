import { Particle, ParticleContainer } from "pixi.js";
import type { Atlas } from "../core/atlas";
import { TABLE_W, TABLE_H, HUMAN_RADIUS } from "../physics/layout";

interface HumanSlot {
  particle: Particle;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wanderT: number;
  speed: number;
}

const MAX_HUMANS = 90;
const MARGIN = 30;
const TOP_MARGIN = 40;
const BOTTOM_MARGIN = 210; // keep clear of the flipper/drain area

const TINTS = [0xffffff, 0xffe0b2, 0xb2e0ff, 0xffb2d0, 0xc9ffb2];

export class HumanSwarm {
  container: ParticleContainer;
  private slots: HumanSlot[] = [];
  aliveCount = 0;

  constructor(atlas: Atlas) {
    this.container = new ParticleContainer({
      // color must stay dynamic: it packs alpha too, and humans spawn/pop by
      // toggling alpha every frame (static color only re-uploads on an
      // explicit container.update() call, which would otherwise leave newly
      // spawned humans invisible).
      dynamicProperties: { position: true, rotation: true, color: true, vertex: false, uvs: false },
    });
    for (let i = 0; i < MAX_HUMANS; i++) {
      const particle = new Particle({
        texture: atlas.human,
        x: -9999,
        y: -9999,
        anchorX: 0.5,
        anchorY: 0.6,
        alpha: 0,
      });
      this.container.addParticle(particle);
      this.slots.push({ particle, alive: false, x: 0, y: 0, vx: 0, vy: 0, wanderT: 0, speed: 40 });
    }
  }

  reset() {
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      slot.alive = false;
      slot.particle.alpha = 0;
      slot.particle.x = -9999;
    }
    this.aliveCount = 0;
  }

  debugSlots() {
    return this.slots
      .filter((s) => s.alive)
      .map((s) => ({ x: s.x, y: s.y, px: s.particle.x, py: s.particle.y, alpha: s.particle.alpha }));
  }

  spawnGroup(x: number, y: number, count: number) {
    let spawned = 0;
    for (const slot of this.slots) {
      if (spawned >= count) break;
      if (slot.alive) continue;
      const a = Math.random() * Math.PI * 2;
      slot.alive = true;
      slot.x = x + Math.cos(a) * 12;
      slot.y = y + Math.sin(a) * 12;
      slot.vx = Math.cos(a) * 60;
      slot.vy = Math.sin(a) * 60;
      slot.wanderT = Math.random() * 1.5;
      slot.speed = 55 + Math.random() * 45;
      slot.particle.alpha = 1;
      slot.particle.tint = TINTS[(Math.random() * TINTS.length) | 0];
      slot.particle.scaleX = slot.particle.scaleY = 0.85 + Math.random() * 0.3;
      spawned++;
      this.aliveCount++;
    }
  }

  /** Pops every alive human within radius of (x, y), e.g. for a chain-reaction relic. */
  popInRadius(x: number, y: number, radius: number, onPop: (x: number, y: number) => void) {
    const radiusSq = radius * radius;
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      const dx = slot.x - x;
      const dy = slot.y - y;
      if (dx * dx + dy * dy > radiusSq) continue;
      slot.alive = false;
      slot.particle.alpha = 0;
      slot.particle.x = -9999;
      this.aliveCount--;
      onPop(slot.x, slot.y);
    }
  }

  /** Returns world-space positions of humans popped this frame, for FX callbacks. */
  update(dt: number, ballPositions: { x: number; y: number }[], catchRadius: number, onPop: (x: number, y: number) => void) {
    const catchRadiusSq = catchRadius * catchRadius;

    for (const slot of this.slots) {
      if (!slot.alive) continue;

      // Flee from the nearest ball if it's close, otherwise wander.
      let fleeX = 0;
      let fleeY = 0;
      let nearestSq = Infinity;
      for (const b of ballPositions) {
        const dx = slot.x - b.x;
        const dy = slot.y - b.y;
        const dsq = dx * dx + dy * dy;
        if (dsq < nearestSq) nearestSq = dsq;
        if (dsq < catchRadiusSq) {
          slot.alive = false;
          slot.particle.alpha = 0;
          slot.particle.x = -9999;
          this.aliveCount--;
          onPop(slot.x, slot.y);
        }
        const fleeRadius = 130;
        if (dsq < fleeRadius * fleeRadius && dsq > 1) {
          const d = Math.sqrt(dsq);
          fleeX += (dx / d) * (1 - d / fleeRadius);
          fleeY += (dy / d) * (1 - d / fleeRadius);
        }
      }
      if (!slot.alive) continue;

      slot.wanderT -= dt;
      if (slot.wanderT <= 0) {
        const a = Math.random() * Math.PI * 2;
        slot.vx = Math.cos(a) * slot.speed;
        slot.vy = Math.sin(a) * slot.speed;
        slot.wanderT = 0.6 + Math.random() * 1.2;
      }

      let moveX = slot.vx;
      let moveY = slot.vy;
      if (fleeX !== 0 || fleeY !== 0) {
        moveX += fleeX * 260;
        moveY += fleeY * 260;
      }
      const mag = Math.hypot(moveX, moveY) || 1;
      const capped = Math.min(mag, slot.speed * 2.2);
      moveX = (moveX / mag) * capped;
      moveY = (moveY / mag) * capped;

      slot.x += moveX * dt;
      slot.y += moveY * dt;

      if (slot.x < MARGIN) {
        slot.x = MARGIN;
        slot.vx = Math.abs(slot.vx);
      } else if (slot.x > TABLE_W - MARGIN) {
        slot.x = TABLE_W - MARGIN;
        slot.vx = -Math.abs(slot.vx);
      }
      if (slot.y < TOP_MARGIN) {
        slot.y = TOP_MARGIN;
        slot.vy = Math.abs(slot.vy);
      } else if (slot.y > TABLE_H - BOTTOM_MARGIN) {
        slot.y = TABLE_H - BOTTOM_MARGIN;
        slot.vy = -Math.abs(slot.vy);
      }

      slot.particle.x = slot.x;
      slot.particle.y = slot.y;
      slot.particle.rotation = Math.atan2(moveY, moveX) + Math.PI / 2;
    }
  }
}

export { HUMAN_RADIUS };
