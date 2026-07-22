import Matter from "matter-js";
import type { FlipperLayout } from "./layout";

// Physics steps at 120Hz (see game.ts STEP_MS) - these are radians per
// step, so they're half of what they'd be at 60Hz to keep the same
// real-world angular speed while moving in smaller, tunnelling-resistant
// increments.
const MAX_ANGULAR_STEP = 0.13; // radians per physics step while active
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

// The collider's tip end is this fraction as wide as its hinge end - a
// real flipper's asymmetric wedge (flat top edge, tapered bottom edge),
// matched exactly by the sprite drawn in core/atlas.ts (which calls
// buildFlipperShape() below - the same function this class uses to build
// its own collider - rather than redrawing an independent approximation
// of it), narrow enough to read as a clean, thin triangle rather than the
// old stubby wedge.
export const TIP_WIDTH_RATIO = 0.14;

export interface FlipperShape {
  /** Local, pre-rotation, chamfered outline - hinge end centred on
   * x=-length/2, tip end on x=+length/2. The single source both this
   * class's Matter collider and core/atlas.ts's sprite are built from, so
   * the two can never draw two different shapes for the same flipper. */
  vertices: { x: number; y: number }[];
  /** See Flipper.anchorOffset's own comment - same meaning here. */
  anchorOffset: { x: number; y: number };
}

/** Builds the wedge outline for a flipper of the given length/width - a
 * flat top edge the full length, and a bottom edge tapering from the full
 * half-width at the hinge down to `tipWidthRatio` of it at the tip, with
 * each end rounded to its own half-width rather than one shared radius.
 * `pad` grows the whole outline (length and width alike) by a fixed
 * amount before rounding, for drawing a slightly oversized outline pass
 * behind the true shape - it is never passed when building the actual
 * collider. */
export function buildFlipperShape(length: number, width: number, tipWidthRatio = TIP_WIDTH_RATIO, pad = 0): FlipperShape {
  const halfLen = length / 2 + pad;
  const halfW = width / 2 + pad;
  const tipHalfW = (width / 2) * tipWidthRatio + pad;

  // Local, pre-rotation vertices, hinge at x=-halfLen and tip at
  // x=+halfLen: a flat top edge the full length (constant -halfW), and
  // a bottom edge tapering from the full half-width at the hinge down
  // to the narrow tip half-width.
  const rawVertices = [
    { x: -halfLen, y: -halfW }, // hinge, top
    { x: halfLen, y: -halfW }, // tip, top
    { x: halfLen, y: tipHalfW }, // tip, bottom
    { x: -halfLen, y: halfW }, // hinge, bottom
  ];
  const hingePoint = { x: -halfLen, y: 0 };
  const centroid = Matter.Vertices.centre(rawVertices);
  const anchorOffset = { x: centroid.x - hingePoint.x, y: centroid.y - hingePoint.y };

  // Quality forced high rather than left to Matter's auto choice, which
  // for a corner this small leaves a visibly faceted "circle" a rolling
  // ball can catch on.
  const vertices = Matter.Vertices.chamfer(rawVertices, [halfW, tipHalfW, tipHalfW, halfW], 12, 2, 14);
  return { vertices, anchorOffset };
}

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
  /** Local-space vector from the hinge point to this shape's true
   * centroid. Matter always centres a body's `position` on its centroid,
   * not on whatever point we'd like to treat as the hinge - for the old
   * plain rectangle those happened to be the same point, but this
   * asymmetric wedge has more of its area toward the wide hinge end, so
   * the centroid sits off to one side of the hinge-to-tip midline. Every
   * position update below has to correct for this fixed offset, or the
   * hinge would visibly drift off `layout.pivot` as the flipper rotates. */
  private readonly anchorOffset: { x: number; y: number };

  constructor(layout: FlipperLayout) {
    this.layout = layout;
    this.currentAngle = layout.restAngle;

    const { pivot, length, width, restAngle } = layout;
    const { vertices, anchorOffset } = buildFlipperShape(length, width);
    this.anchorOffset = anchorOffset;

    this.body = Matter.Body.create({
      position: this.centreFor(pivot, restAngle),
      vertices,
      angle: restAngle,
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
    const { pivot } = this.layout;
    const prevX = this.body.position.x;
    const prevY = this.body.position.y;
    const { x: cx, y: cy } = this.centreFor(pivot, this.currentAngle);
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

  /** Where the body's centroid (what Matter treats as its `position`)
   * needs to be so that the hinge point itself lands exactly on `pivot`
   * at the given angle - `anchorOffset` rotated by the current angle,
   * added to the pivot. See the field's own comment for why this isn't
   * simply `pivot + length/2` the way it was for the old symmetric shape. */
  private centreFor(pivot: { x: number; y: number }, angle: number): { x: number; y: number } {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: pivot.x + this.anchorOffset.x * cos - this.anchorOffset.y * sin,
      y: pivot.y + this.anchorOffset.x * sin + this.anchorOffset.y * cos,
    };
  }
}
