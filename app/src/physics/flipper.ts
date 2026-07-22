import Matter from "matter-js";
import type { FlipperLayout } from "./layout";

// Physics steps at 120Hz (see game.ts STEP_MS) - these are radians per
// step, so they're half of what they'd be at 60Hz to keep the same
// real-world angular speed while moving in smaller, tunnelling-resistant
// increments.
const MAX_ANGULAR_STEP = 0.16; // radians per physics step while active
const RETURN_ANGULAR_STEP = 0.1; // slower relax back to rest

// Scales only the velocity/angularVelocity reported to Matter for
// collision purposes (see step() below) - the body's actual
// position/angle still snap at full MAX_ANGULAR_STEP speed, so the flip
// itself still looks and feels instant. This is what the ball's kick
// strength is computed from, so scaling it down here (while the FLIPPER
// powerup's speedMultiplier is left to scale the *unscaled* swing speed
// on top of it) keeps a stock flipper's kick modest while leaving real
// headroom for the powerup to make a noticeably harder-hitting flipper,
// instead of every hit already sitting near a shared ceiling from the
// start.
const KICK_SCALE = 0.65;

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
    //
    // No friction/restitution passed above, on purpose - setStatic (called
    // right below) unconditionally overwrites both (friction -> 1,
    // restitution -> 0) on every static body no matter what's in the
    // constructor options, so a value up there would silently never apply.
    // Harmless here too: friction pairs on the *lower* of the two values,
    // so the flipper being forced to max strength just means the ball's
    // own friction (see physics/world.ts's spawnBall) decides the contact;
    // restitution pairs on the *higher* value, and the ball's 0.42 already
    // wins against the flipper's forced 0.
    Matter.Body.setStatic(this.body, true);
  }

  setHeld(held: boolean) {
    this.held = held;
  }

  /** Advance one fixed physics step, or a `fraction` of one when the
   * caller is sub-stepping the swing (see physics/world.ts's step()) -
   * pass e.g. 0.25 to move a quarter as far this call, matched with a
   * quarter-size Engine.update() dt, so a fast swing gets checked for
   * collisions several times along its arc instead of just at the two
   * endpoints. A full-speed swing can cover several ball-diameters of
   * paddle travel in one un-substepped tick, and Matter has no continuous
   * collision detection, so the ball could end up on the far side of the
   * paddle at the next check without ever registering contact in between
   * - substepping is what actually closes that gap, not just running
   * physics at a higher fixed rate (already tried; helped but didn't
   * eliminate it, since it doesn't shrink the *paddle's* own per-check
   * displacement specifically). Call once per Engine.update(). */
  step(fraction = 1) {
    const target = this.held ? this.layout.activeAngle : this.layout.restAngle;
    const maxStep = (this.held ? MAX_ANGULAR_STEP * this.speedMultiplier : RETURN_ANGULAR_STEP) * fraction;

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
    // (position delta, no separate time division needed) - not zeroed,
    // and scaled by KICK_SCALE (see above) so the reported kick is gentler
    // than the arm's real snap speed. This is what lets a ball genuinely
    // get flung harder the faster the flipper is actually swinging when it
    // makes contact, and get nothing extra from a flipper that's just
    // sitting there raised and stationary, purely through normal physics
    // rather than any bespoke "was this contact within some window"
    // bookkeeping. Deliberately NOT rescaled back up to a full-step-
    // equivalent rate when substepping (fraction < 1) despite each
    // substep's raw displacement being proportionally smaller - a ball
    // that stays in contact across several consecutive substeps (common
    // once the swing is fine-grained enough to avoid tunnelling, see
    // FLIPPER_SUBSTEPS in physics/world.ts) picks up a fraction of the
    // kick on *each* of those substeps, and those fractions add up over
    // the contact window to roughly the same total as one full-strength
    // hit - rescaling each one back up on top of that compounded into a
    // wildly over-strength kick in testing (every solid hit maxed out
    // MAX_BALL_SPEED) instead of the intended dynamic range.
    Matter.Body.setVelocity(this.body, { x: (cx - prevX) * KICK_SCALE, y: (cy - prevY) * KICK_SCALE });
    Matter.Body.setAngularVelocity(this.body, diff * KICK_SCALE);
  }
}
