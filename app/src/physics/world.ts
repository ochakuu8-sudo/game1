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
      restitution: 0.7,
      chamfer: { radius: r.cornerRadius },
    });
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
    // Matter always uses the *higher* of a pair's two restitution values
    // (see the ball's own restitution comment in spawnBall below), so this
    // value alone governs how bouncy the ball is against every wall here -
    // the outer walls, outlane rails, AND the flipper hinge guards, which
    // is exactly the surface a ball settling near a flipper spends the
    // most time grazing. Lowering the ball's restitution alone didn't fix
    // resting/rolling judder against these because 0.4 kept winning the
    // max() every time; kept low here too so a ball resting or rolling
    // along any wall - not just the flipper itself - actually settles.
    const opts: Matter.IChamferableBodyDefinition = { isStatic: true, label: "wall", restitution: 0.12 };

    for (const w of OUTER_WALLS) {
      walls.push(Bodies.rectangle(w.x, w.y, w.w, w.h, { ...opts, angle: w.angle ?? 0 }));
    }

    // Outlane guides feeding each flipper - see layout.ts for why these are
    // single overlapping segments rather than multiple joined ones.
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
    // segment (a ball can wedge into a flat-meets-circle corner).
    for (const g of FLIPPER_HINGE_GUARDS) {
      walls.push(Bodies.circle(g.x, g.y, g.radius, opts));
    }

    World.add(this.world, walls);
  }

  spawnBall(x = TABLE_W / 2, y = 60): Matter.Body {
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
      // A normal, fairly lively pinball-ball value. This used to be pinned
      // much lower (0.12) as a workaround: the flipper was a fully inert
      // static body (zeroed velocity every step) with a scripted "kick" on
      // top, and any bounce off it or the walls kept re-triggering that
      // low-restitution-with-explicit-boost combination in ways that read
      // as judder. Now that the flipper reports its own real instantaneous
      // velocity (see physics/flipper.ts) and there's no separate kick
      // system to misfire, restitution is free to be a normal value again
      // - resting/rolling contact settles cleanly regardless (verified:
      // stays at an exact standstill for 7+s after landing on a stopped,
      // held flipper), since that settling was never really about this
      // number in the first place.
      restitution: 0.42,
      friction: 0.02,
      frictionAir: 0.0012,
      density: 0.04,
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
    this.leftFlipper.step();
    this.rightFlipper.step();
    Engine.update(this.engine, dtMs);

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
