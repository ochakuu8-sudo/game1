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
  /** +1 if activating rotates the angle up (clockwise in screen/y-down
   * terms), -1 if down - i.e. the sign of the flipper's angular velocity
   * while held. Used to derive the tangential (swing-direction) kick
   * instead of a naive push straight away from the pivot. */
  readonly sweepSign: number;
  /** Radians turned *this step* (i.e. angular velocity in "per physics
   * step" units, which conveniently is exactly the unit Matter's own
   * body.velocity is in given a constant step size - no further
   * conversion needed). Used so a ball caught mid-snap gets flung much
   * harder than one merely resting on an already-raised, stationary
   * flipper - matching how a real flipper's kick depends on how fast it's
   * actually moving when it makes contact. */
  angularVelocity = 0;
  /** Balls already kicked during the current press. A kick is a discrete
   * action tied to *the press*, like a real flip - not a continuous force
   * re-applied for as long as the button is down. Matter fires
   * collisionStart just as readily for a ball settling/wobbling in
   * ongoing contact as for a genuinely new arrival (a ball can lose and
   * regain contact with the blade many times a second while just resting
   * against it), so no amount of *time-based* gating on that event can
   * reliably tell those apart - every threshold tried either let a
   * resting ball get re-kicked indefinitely, or starved a legitimate late
   * arrival of its kick. Tracking "have I already kicked this ball since
   * the button went down" sidesteps the question entirely: cleared on
   * every fresh press (see step()), so each ball gets exactly one kick
   * per press, however many times collisionStart fires for it. */
  kickedThisPress = new Set<Matter.Body>();

  constructor(layout: FlipperLayout) {
    this.layout = layout;
    this.currentAngle = layout.restAngle;
    this.sweepSign = Math.sign(layout.activeAngle - layout.restAngle);

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
    // Static, not just infinite-inertia: this body's position/angle are
    // always externally overwritten in step() below, never driven by
    // forces, which is exactly what Matter's static bodies are for. An
    // earlier version left it non-static with only inertia forced to
    // Infinity, which blocks the solver's *rotational* position
    // correction but not its *linear* one - with finite mass, any overlap
    // correction was still split between ball and flipper by inverse
    // mass, and since the flipper's share got overwritten right back to
    // its pivot-computed position on the very next step anyway, that
    // correction silently piled onto the ball instead: no velocity change
    // (so invisible in any velocity-based check), just a tiny position
    // creep every step that read as the ball juddering in place. isStatic
    // gives the flipper infinite mass too, so 100% of any correction goes
    // to the ball, the physically consistent outcome for a body the ball
    // can never actually push.
    Matter.Body.setStatic(this.body, true);
  }

  private wasHeld = false;

  setHeld(held: boolean) {
    this.held = held;
  }

  /** Advance one fixed physics step. Call once per Engine.update(). */
  step() {
    if (this.held && !this.wasHeld) this.kickedThisPress.clear();
    this.wasHeld = this.held;

    const target = this.held ? this.layout.activeAngle : this.layout.restAngle;
    const maxStep = this.held ? MAX_ANGULAR_STEP : RETURN_ANGULAR_STEP;

    let diff = target - this.currentAngle;
    if (Math.abs(diff) > maxStep) {
      diff = Math.sign(diff) * maxStep;
    }
    this.currentAngle += diff;
    this.angularVelocity = diff;

    // Pin the body to the exact position/angle a rigid arm of this length
    // would have at currentAngle, computed fresh from the pivot every step
    // - NOT by rotating relative to the body's current (possibly
    // collision-perturbed) position. Now that the body is static (see
    // constructor) the solver won't perturb its position at all, but
    // recomputing from scratch is still the more robust approach - there's
    // nothing for any future change to this body's config to compound.
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
