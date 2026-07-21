import { Particle, ParticleContainer, Texture } from "pixi.js";
import type { Atlas } from "../core/atlas";
import { PALETTE } from "../core/palette";

interface Slot {
  particle: Particle;
  active: boolean;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  maxLife: number;
  gravity: number;
  fade: boolean;
}

/**
 * Fixed-size pool of particles living permanently inside one ParticleContainer.
 * We never add/remove particles at runtime (that would dirty + rebuild the
 * GPU buffer); inactive slots are just parked off-screen with alpha 0. This
 * keeps debris/sparks/smoke effectively "free" even at high churn on mobile.
 */
class ParticlePool {
  container: ParticleContainer;
  private slots: Slot[] = [];
  private cursor = 0;

  constructor(texture: Texture, count: number) {
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, rotation: true, color: true, vertex: false, uvs: false },
    });
    for (let i = 0; i < count; i++) {
      const particle = new Particle({ texture, x: -9999, y: -9999, anchorX: 0.5, anchorY: 0.5, alpha: 0 });
      this.container.addParticle(particle);
      this.slots.push({ particle, active: false, vx: 0, vy: 0, spin: 0, life: 0, maxLife: 1, gravity: 0, fade: true });
    }
  }

  spawn(opts: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    scale?: number;
    spin?: number;
    life?: number;
    gravity?: number;
    tint?: number;
  }) {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.active = true;
    slot.vx = opts.vx;
    slot.vy = opts.vy;
    slot.spin = opts.spin ?? 0;
    slot.life = 0;
    slot.maxLife = opts.life ?? 0.6;
    slot.gravity = opts.gravity ?? 0;

    const p = slot.particle;
    p.x = opts.x;
    p.y = opts.y;
    p.scaleX = p.scaleY = opts.scale ?? 1;
    p.rotation = Math.random() * Math.PI * 2;
    p.alpha = 1;
    p.tint = opts.tint ?? 0xffffff;
  }

  update(dt: number) {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.life += dt;
      if (slot.life >= slot.maxLife) {
        slot.active = false;
        slot.particle.alpha = 0;
        slot.particle.x = -9999;
        slot.particle.y = -9999;
        continue;
      }
      const p = slot.particle;
      slot.vy += slot.gravity * dt;
      p.x += slot.vx * dt;
      p.y += slot.vy * dt;
      p.rotation += slot.spin * dt;
      const t = slot.life / slot.maxLife;
      p.alpha = 1 - t;
    }
  }
}

export class ParticleFX {
  debris: ParticlePool;
  spark: ParticlePool;
  smoke: ParticlePool;

  constructor(atlas: Atlas) {
    this.debris = new ParticlePool(atlas.debris, 160);
    this.spark = new ParticlePool(atlas.spark, 140);
    this.smoke = new ParticlePool(atlas.smoke, 60);
  }

  update(dt: number) {
    this.debris.update(dt);
    this.spark.update(dt);
    this.smoke.update(dt);
  }

  hitSpark(x: number, y: number, count = 6) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      this.spark.spawn({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        scale: 0.5 + Math.random() * 0.5,
        spin: (Math.random() - 0.5) * 10,
        life: 0.25 + Math.random() * 0.2,
      });
    }
  }

  buildingCollapse(x: number, y: number) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 220;
      this.debris.spawn({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 80,
        scale: 0.6 + Math.random() * 0.9,
        spin: (Math.random() - 0.5) * 8,
        life: 0.7 + Math.random() * 0.5,
        gravity: 420,
      });
    }
    for (let i = 0; i < 8; i++) {
      this.smoke.spawn({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 20,
        vy: -20 - Math.random() * 30,
        scale: 0.8 + Math.random() * 1.2,
        spin: (Math.random() - 0.5) * 1,
        life: 0.8 + Math.random() * 0.6,
      });
    }
  }

  humanPop(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 120;
      this.spark.spawn({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        scale: 0.35 + Math.random() * 0.35,
        spin: (Math.random() - 0.5) * 6,
        life: 0.3 + Math.random() * 0.25,
        tint: PALETTE.pink,
      });
    }
  }
}
