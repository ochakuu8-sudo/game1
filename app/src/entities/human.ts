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
  targetVx: number;
  targetVy: number;
  stride: number;
  speed: number;
  frame: number;
}

const MAX_HUMANS = 90;
const MARGIN = 30;
const TOP_MARGIN = 40;
const BOTTOM_MARGIN = 210; // keep clear of the flipper/drain area

const TINTS = [0xffffff, 0xffe0b2, 0xb2e0ff, 0xffb2d0, 0xc9ffb2];

export class HumanSwarm {
  container: ParticleContainer;
  private slots: HumanSlot[] = [];
  private runTextures: Atlas["human"][];
  aliveCount = 0;

  constructor(atlas: Atlas) {
    this.runTextures = [atlas.human, atlas.humanRun];
    this.container = new ParticleContainer({
      // color must stay dynamic: it packs alpha too, and humans spawn/pop by
      // toggling alpha every frame (static color only re-uploads on an
      // explicit container.update() call, which would otherwise leave newly
      // spawned humans invisible). vertex packs scaleX/scaleY (and the
      // anchor/texture-trim used to size the quad) - it must also be
      // dynamic since scale is set per-spawn (random size variety) and
      // every frame (the walk-cycle squash bob below); with it static,
      // those writes land on the JS object but never reach the GPU buffer
      // without an explicit container.update() call, so every human
      // silently rendered at its very first (default 1x1) scale
      // regardless of what the code set afterwards - confirmed by forcing
      // an exaggerated scale range and seeing no size change on screen.
      dynamicProperties: { position: true, rotation: true, color: true, vertex: true, uvs: true },
    });
    for (let i = 0; i < MAX_HUMANS; i++) {
      const particle = new Particle({
        texture: atlas.human,
        x: -9999,
        y: -9999,
        anchorX: 0.5,
        anchorY: 0.52,
        alpha: 0,
      });
      this.container.addParticle(particle);
      this.slots.push({
        particle,
        alive: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        targetVx: 0,
        targetVy: 0,
        stride: 0,
        speed: 40,
        frame: -1,
      });
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
      slot.targetVx = slot.vx;
      slot.targetVy = slot.vy;
      slot.speed = 45 + Math.random() * 35;
      slot.stride = Math.random() * Math.PI * 2;
      slot.frame = -1;
      slot.particle.alpha = 1;
      slot.particle.tint = TINTS[(Math.random() * TINTS.length) | 0];
      slot.particle.scaleX = slot.particle.scaleY = 0.8 + Math.random() * 0.3;
      spawned++;
      this.aliveCount++;
    }
  }

  /** Returns world-space positions of humans popped this frame, for FX callbacks. */
  update(dt: number, ballPositions: { x: number; y: number }[], catchRadius: number, onPop: (x: number, y: number) => void) {
    const catchRadiusSq = catchRadius * catchRadius;

    for (const slot of this.slots) {
      if (!slot.alive) continue;

      // Keep wandering through the city, veering sharply away from a kaiju.
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

      // A small random turn makes the crowd feel panicked rather than like
      // particles following a fixed route.
      const turn = (Math.random() - 0.5) * dt * 3;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      slot.targetVx = slot.vx * cos - slot.vy * sin;
      slot.targetVy = slot.vx * sin + slot.vy * cos;
      const ease = 1 - Math.exp(-dt * 5);
      slot.vx += (slot.targetVx - slot.vx) * ease;
      slot.vy += (slot.targetVy - slot.vy) * ease;

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

      // Humans never leave the playfield: clamp them inside the visible
      // city and reflect their velocity when they reach any boundary.
      const maxX = TABLE_W - MARGIN;
      const maxY = TABLE_H - BOTTOM_MARGIN;
      if (slot.x < MARGIN || slot.x > maxX) {
        slot.x = Math.max(MARGIN, Math.min(maxX, slot.x));
        slot.vx = slot.targetVx = slot.x === MARGIN ? Math.abs(slot.vx) : -Math.abs(slot.vx);
      }
      if (slot.y < TOP_MARGIN || slot.y > maxY) {
        slot.y = Math.max(TOP_MARGIN, Math.min(maxY, slot.y));
        slot.vy = slot.targetVy = slot.y === TOP_MARGIN ? Math.abs(slot.vy) : -Math.abs(slot.vy);
      }

      slot.particle.x = slot.x;
      slot.particle.y = slot.y;
      // Pedestrians stay visually upright. Rotating the whole sprite toward
      // its velocity made people appear to tumble/lie down as they fled.
      slot.particle.rotation = 0;
      slot.stride += dt * (10 + slot.speed * 0.08);
      const frame = Math.sin(slot.stride) >= 0 ? 1 : 0;
      if (frame !== slot.frame) {
        slot.frame = frame;
        slot.particle.texture = this.runTextures[frame];
      }
      const bob = Math.abs(Math.sin(slot.stride)) * 0.035;
      slot.particle.scaleX = 0.96;
      slot.particle.scaleY = 0.96 - bob;
    }
  }
}

export { HUMAN_RADIUS };
