import Matter from "matter-js";
import type { FlipperLayout } from "./layout";

// Physics steps at 120Hz (see game.ts STEP_MS) - these are radians per
// step, so they're half of what they'd be at 60Hz to keep the same
// real-world angular speed while moving in smaller, tunnelling-resistant
// increments.
const MAX_ANGULAR_STEP = 0.16; // radians per physics step while active
const RETURN_ANGULAR_STEP = 0.1; // slower relax back to rest

export class Flipper {
  body: Matter.Body;
  layout: FlipperLayout;
  currentAngle: number;
  held = false;

  constructor(layout: FlipperLayout) {
    this.layout = layout;
    this.currentAngle = layout.restAngle;

    const { pivot, length, width, restAngle } = layout;
    const cx = pivot.x + Math.cos(restAngle) * (length / 2);
    const cy = pivot.y + Math.sin(restAngle) * (length / 2);

    this.body = Matter.Bodies.rectangle(cx, cy, length, width, {
      angle: restAngle,
      chamfer: { radius: width / 2 },
      label: "flipper",
      friction: 0.05,
      restitution: 0.35,
      density: 0.02,
    });
    Matter.Body.setStatic(this.body, false);
    Matter.Body.setInertia(this.body, Infinity);
  }

  setHeld(held: boolean) {
    this.held = held;
  }

  /** Advance one fixed physics step. Call once per Engine.update(). */
  step() {
    const target = this.held ? this.layout.activeAngle : this.layout.restAngle;
    const maxStep = this.held ? MAX_ANGULAR_STEP : RETURN_ANGULAR_STEP;

    let diff = target - this.currentAngle;
    if (Math.abs(diff) > maxStep) {
      diff = Math.sign(diff) * maxStep;
    }
    this.currentAngle += diff;

    // Pin the body to the exact position/angle a rigid arm of this length
    // would have at currentAngle, computed fresh from the pivot every step
    // - NOT by rotating relative to the body's current (possibly
    // collision-perturbed) position. Matter's solver can nudge a resting
    // body's position directly to resolve overlap even with velocity at
    // zero and infinite inertia (which only blocks rotational correction,
    // not linear); basing the next step on that live position would carry
    // the nudge forward and, under sustained contact, compound it every
    // step (verified: unbounded drift within a few seconds of the ball
    // resting against a held flipper). Recomputing from scratch each step
    // makes that impossible - there's nothing to compound.
    const { pivot, length } = this.layout;
    const cx = pivot.x + Math.cos(this.currentAngle) * (length / 2);
    const cy = pivot.y + Math.sin(this.currentAngle) * (length / 2);
    // Omitting the 3rd (updateVelocity) arg leaves it undefined/falsy, same
    // as passing false - @types/matter-js doesn't declare that parameter.
    Matter.Body.setPosition(this.body, { x: cx, y: cy });
    Matter.Body.setAngle(this.body, this.currentAngle);
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(this.body, 0);
  }
}
