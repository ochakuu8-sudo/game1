import Matter from "matter-js";
import type { FlipperLayout } from "./layout";

// @types/matter-js is missing the (point, updateVelocity) overload that the
// actual runtime implements (see matter-js/src/body/Body.js Body.rotate).
// Passing updateVelocity=true makes Matter derive the body's velocity from
// the position/angle delta itself, which is exactly what gives the flipper
// its "kick" against the ball.
type RotateFn = (body: Matter.Body, rotation: number, point?: Matter.Vector, updateVelocity?: boolean) => void;
const rotateBody = Matter.Body.rotate as unknown as RotateFn;

const MAX_ANGULAR_STEP = 0.32; // radians per physics step (~60Hz) while active
const RETURN_ANGULAR_STEP = 0.2; // slower relax back to rest

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
      restitution: 0.2,
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
    const movingToActive = this.held;
    const maxStep = movingToActive ? MAX_ANGULAR_STEP : RETURN_ANGULAR_STEP;

    let diff = target - this.currentAngle;
    if (Math.abs(diff) > maxStep) {
      diff = Math.sign(diff) * maxStep;
    }
    if (diff === 0) return;

    const newAngle = this.currentAngle + diff;
    rotateBody(this.body, diff, this.layout.pivot, true);
    this.currentAngle = newAngle;
  }
}
