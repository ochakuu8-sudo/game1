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
  /** Scales the active swing speed while held (the FLIPPER powerup) - a
   * literally faster-swinging flipper, which (now that kicks come from
   * real collision physics, not a scripted boost) hits the ball harder on
   * its own, the same way a real stronger solenoid would. */
  speedMultiplier = 1;

  constructor(layout: FlipperLayout) {
    this.layout = layout;
    this.currentAngle = layout.restAngle;

    const { pivot, length, width, restAngle } = layout;
    const cx = pivot.x + Math.cos(restAngle) * (length / 2);
    const cy = pivot.y + Math.sin(restAngle) * (length / 2);

    this.body = Matter.Bodies.rectangle(cx, cy, length, width, {
      angle: restAngle,
      // Matter's auto quality for a rounded corner this small (radius 10)
      // works out to only ~4 straight segments per end - a visibly
      // faceted "circle" a rolling ball can catch on as it crosses each
      // facet's edge. Forcing a higher quality gives a much closer
      // approximation to an actual circular cap.
      chamfer: { radius: width / 2, quality: 12 },
      label: "flipper",
      friction: 0.05,
      restitution: 0.35,
      density: 0.02,
    });
    // Static: position/angle are always externally set in step() below,
    // never driven by forces, which is exactly what Matter's static
    // bodies are for. Being static gives it infinite mass/inertia, so the
    // collision solver never moves *it* - but critically, Engine.js skips
    // its own Body.update (the position/velocity integration step)
    // entirely for static bodies, meaning body.velocity/angularVelocity
    // are otherwise-inert fields we fully control that never get
    // overwritten by the physics loop. The collision *resolver* still
    // reads them when computing impulses regardless of the static flag
    // (see collision/Resolver.js) - so setting them to the flipper's real
    // instantaneous motion each step (done in step() below) makes Matter's
    // own native collision response transfer realistic momentum to the
    // ball, the same way a real moving flipper arm would, with no scripted
    // "kick" needed at all.
    Matter.Body.setStatic(this.body, true);
  }

  setHeld(held: boolean) {
    this.held = held;
  }

  /** Advance one fixed physics step. Call once per Engine.update(). */
  step() {
    const target = this.held ? this.layout.activeAngle : this.layout.restAngle;
    const maxStep = this.held ? MAX_ANGULAR_STEP * this.speedMultiplier : RETURN_ANGULAR_STEP;

    let diff = target - this.currentAngle;
    if (Math.abs(diff) > maxStep) {
      diff = Math.sign(diff) * maxStep;
    }
    this.currentAngle += diff;

    // Pin the body to the exact position/angle a rigid arm of this length
    // would have at currentAngle, computed fresh from the pivot every step
    // - NOT by rotating relative to the body's current (possibly
    // collision-perturbed) position, which caused unbounded drift in an
    // earlier version. Recomputing from scratch each step makes that
    // impossible - there's nothing to compound.
    const { pivot, length } = this.layout;
    const prevX = this.body.position.x;
    const prevY = this.body.position.y;
    const cx = pivot.x + Math.cos(this.currentAngle) * (length / 2);
    const cy = pivot.y + Math.sin(this.currentAngle) * (length / 2);
    // Omitting the 3rd (updateVelocity) arg leaves it undefined/falsy, same
    // as passing false - @types/matter-js doesn't declare that parameter.
    Matter.Body.setPosition(this.body, { x: cx, y: cy });
    Matter.Body.setAngle(this.body, this.currentAngle);
    // The body's velocity, for collision-response purposes (see the static
    // note above): this step's actual displacement/rotation, in exactly
    // the "per step" units Matter's own Verlet integration uses internally
    // (position delta, no separate time division needed) - not zeroed.
    // This is what lets a ball genuinely get flung harder the faster the
    // flipper is actually swinging when it makes contact, and get nothing
    // extra from a flipper that's just sitting there raised and
    // stationary, purely through normal physics rather than any bespoke
    // "was this contact within some window" bookkeeping.
    Matter.Body.setVelocity(this.body, { x: cx - prevX, y: cy - prevY });
    Matter.Body.setAngularVelocity(this.body, diff);
  }
}
