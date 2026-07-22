import Matter from "matter-js";
import {
  TABLE_W,
  buildingRect,
  BALL_RADIUS,
  LEFT_FLIPPER,
  RIGHT_FLIPPER,
  OUTER_WALLS,
  OUTLANE_GUIDES,
  FLIPPER_HINGE_GUARDS,
  type BuildingSlot,
} from "./layout";
import { Flipper } from "./flipper";

const { Engine, World, Bodies } = Matter;

export const CATEGORY_BALL = 0x0002;
export const CATEGORY_WORLD = 0x0001;
export const CATEGORY_BUILDING = 0x0004;

// A normal roll/fall/bounce never gets near this (typically under ~12).
// A genuine flipper hit is *supposed* to spike well past that - measured
// 19-26 depending on contact point (tip hits carry more swing speed than
// hits near the pivot), up to ~30 with the FLIPPER powerup maxed out -
// that variation by timing/contact point is exactly what makes a flip
// feel dynamic rather than a fixed-strength bump. This used to be set to
// 15, which sat *below* that whole natural range and silently flattened
// every solid flip to the same capped speed regardless of how it was
// actually hit - it looked like the collision response wasn't reacting to
// the swing at all. Kept only as a safety net a good deal above the real
// range, for the rare compounding multi-bounce spike, not to tame normal
// flipper kicks.
const MAX_BALL_SPEED = 34;

// How many slices each physics step's flipper motion is broken into for
// collision purposes (see step() below and Flipper.step()'s own comment) -
// 4 was enough to stop a ball parked right in a fast swing's path from
// ever tunnelling clean through in repeated testing, without still-visible
// step gaps.
const FLIPPER_SUBSTEPS = 4;

// Explicitly restored on the outer walls after construction (see
// buildStaticTable's own comment for why a plain `restitution: 0.7` in the
// constructor options wouldn't stick) - close to the ball's old uniform
// 0.42 so wall bounce keeps its existing feel now that the ball's own
// restitution (see spawnBall) has been lowered to make slopes/the flipper
// non-bouncy instead.
const WALL_RESTITUTION = 0.42;
// Same restoration on buildings, for the same reason - a satisfying bounce
// off a building being hit is still wanted, only the flipper/slopes needed
// to stop bouncing.
const BUILDING_RESTITUTION = 0.7;

export class PinballWorld {
  engine: Matter.Engine;
  world: Matter.World;
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  buildingBodies: Matter.Body[] = [];
  balls: Matter.Body[] = [];

  constructor() {
    this.engine = Engine.create();
    this.engine.gravity.y = 0.8;
    // Extra solver iterations for more reliable resolution against the
    // fast-snapping flipper bodies (default is 6/4).
    this.engine.positionIterations = 12;
    this.engine.velocityIterations = 10;
    this.world = this.engine.world;

    this.buildStaticTable();

    this.leftFlipper = new Flipper(LEFT_FLIPPER);
    this.rightFlipper = new Flipper(RIGHT_FLIPPER);
    World.add(this.world, [this.leftFlipper.body, this.rightFlipper.body]);
  }

  /** Adds one new building collider for a freshly-spawned lot (see
   * Game.trySpawnBuilding) - lots come and go individually now (a spawner
   * fires on its own cooldown, a lot is destroyed and removed on its own),
   * so bodies are added/removed one at a time rather than the whole set
   * being rebuilt together. */
  addBuildingBody(slot: BuildingSlot): Matter.Body {
    const r = buildingRect(slot);
    const body = Bodies.rectangle(r.x, r.y, r.width, r.height, {
      isStatic: true,
      label: "building",
      chamfer: { radius: r.cornerRadius },
    });
    // Set after construction, not in the options above - see
    // buildStaticTable's comment on WALL_RESTITUTION for why a restitution
    // passed alongside isStatic: true there gets silently discarded.
    body.restitution = BUILDING_RESTITUTION;
    this.buildingBodies.push(body);
    World.add(this.world, body);
    return body;
  }

  /** Removes one lot's collider for good once it's fully destroyed and its
   * collapse animation has finished (see Game.tick). */
  removeBuildingBody(body: Matter.Body) {
    const i = this.buildingBodies.indexOf(body);
    if (i >= 0) this.buildingBodies.splice(i, 1);
    World.remove(this.world, body);
  }

  private buildStaticTable() {
    const walls: Matter.Body[] = [];
    // No friction set here on purpose - Matter.Body.setStatic (called
    // internally the moment a body is created with isStatic: true, see
    // matter-js/src/body/Body.js's _initProperties) unconditionally
    // overwrites friction to 1 on every static body regardless of whatever's
    // passed in these options, so a value here would silently do nothing.
    // That works in our favour: Matter uses the *lower* of a pair's two
    // friction values, and a static body being forced to a max-strength 1
    // just means the ball's own friction (see spawnBall below) is what
    // actually decides every wall/rail/flipper contact.
    //
    // Restitution is a different story - setStatic forces it to 0 the same
    // way, but *after* construction there's nothing stopping a plain
    // `body.restitution = x` write from sticking (Pair.update reads it
    // fresh every step, see physics/world.ts's own history/PR notes), and
    // Matter pairs on the *higher* of the two bodies' values - so the outer
    // walls get it explicitly restored to WALL_RESTITUTION right below,
    // while the outlane guides/hinge guards deliberately do NOT get it
    // restored: leaving them at the forced 0 means their pair restitution
    // is whatever the ball itself carries (see spawnBall's low value), so
    // the ball hugs the slope into the flipper instead of bouncing down it.
    const opts: Matter.IChamferableBodyDefinition = { isStatic: true, label: "wall" };

    for (const w of OUTER_WALLS) {
      const body = Bodies.rectangle(w.x, w.y, w.w, w.h, { ...opts, angle: w.angle ?? 0 });
      body.restitution = WALL_RESTITUTION;
      walls.push(body);
    }

    // Outlane guides feeding each flipper - see layout.ts for why these are
    // single overlapping segments rather than multiple joined ones. No
    // restitution restored here - see this method's own top comment - so a
    // ball riding down toward the flipper stays on the slope instead of
    // bouncing off it.
    for (const s of OUTLANE_GUIDES) {
      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      walls.push(
        Bodies.rectangle((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, length, s.thickness, { ...opts, angle }),
      );
    }

    // Rounded caps bridging each rail to its flipper's hinge - see
    // layout.ts for why these need to be round rather than another flat
    // segment (a ball can wedge into a flat-meets-circle corner). Same
    // no-restitution-restored treatment as the guides they bridge, for the
    // same reason.
    for (const g of FLIPPER_HINGE_GUARDS) {
      walls.push(Bodies.circle(g.x, g.y, g.radius, opts));
    }

    World.add(this.world, walls);
  }

  spawnBall(x = TABLE_W / 2, y = 60): Matter.Body {
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
      // Kept low so the ball hugs a slope or a resting flipper - lands and
      // rolls along it - instead of bouncing back off on contact, which
      // read as unpredictable and made lining up a return hit hard. Matter
      // pairs on the *higher* of a pair's two restitution values, so this
      // number alone decides bounce against anything that doesn't restore
      // its own restitution after construction (the flipper, the outlane
      // guides, the hinge guards - see buildStaticTable) - the outer walls
      // and buildings *do* restore theirs (WALL_RESTITUTION/
      // BUILDING_RESTITUTION above), so they still bounce the way they
      // always have. This used to be a single uniform 0.42 for every
      // surface (before that, 0.12, back when the flipper was a fully
      // inert body with a scripted "kick" bolted on top - long gone, see
      // physics/flipper.ts) - this is the first time bounce has actually
      // differed by surface rather than being one shared number.
      restitution: 0.02,
      // Matter uses the *lower* of a pair's two friction values, and every
      // wall/rail/flipper is forced to a max-strength 1 by Matter itself
      // (see buildStaticTable above), so this number alone is what decides
      // how well the ball grips everything it touches. A modest bump from
      // the old 0.02 - see the `inertia` override below for the change
      // that actually mattered for rolling.
      friction: 0.2,
      frictionAir: 0.0012,
      density: 0.04,
      // Matter auto-computes a circle's moment of inertia from its density
      // like a *disc*, which came out roughly 4x higher than a real ball
      // of this mass should have - with that much rotational inertia, the
      // available friction torque could barely spin the ball up at all, so
      // it visibly slid/skidded down slopes and along the flipper instead
      // of rolling, no matter how much friction was dialled in (verified:
      // raising friction alone, 0.02 up to 5, changed nothing - only
      // lowering inertia did). This explicit override is close to a solid
      // sphere's real inertia (0.4 * mass * radius^2 ~= 1388 here) rather
      // than the disc default, and picking something a bit below even that
      // makes the catch-up-to-rolling transition read as instant rather
      // than a visible beat of skidding first.
      inertia: 500,
      label: "ball",
    });
    Matter.Body.setVelocity(ball, { x: (Math.random() - 0.5) * 2, y: 0 });
    this.balls.push(ball);
    World.add(this.world, ball);
    return ball;
  }

  removeBall(ball: Matter.Body) {
    const i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
    World.remove(this.world, ball);
  }

  step(dtMs: number) {
    // Sub-stepped rather than one big move + one Engine.update() - see
    // Flipper.step()'s own comment for why a single full-speed swing per
    // physics tick could let the paddle skip clean over a ball without
    // Matter ever detecting the overlap.
    const subDt = dtMs / FLIPPER_SUBSTEPS;
    for (let i = 0; i < FLIPPER_SUBSTEPS; i++) {
      this.leftFlipper.step(1 / FLIPPER_SUBSTEPS);
      this.rightFlipper.step(1 / FLIPPER_SUBSTEPS);
      Engine.update(this.engine, subDt);
    }

    for (const ball of this.balls) {
      const { x, y } = ball.velocity;
      const speed = Math.hypot(x, y);
      if (speed > MAX_BALL_SPEED) {
        const scale = MAX_BALL_SPEED / speed;
        Matter.Body.setVelocity(ball, { x: x * scale, y: y * scale });
      }
    }
  }
}
