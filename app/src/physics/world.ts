import Matter from "matter-js";
import {
  TABLE_W,
  BUILDING_SLOTS,
  BUILDING_VARIANTS,
  BALL_RADIUS,
  LEFT_FLIPPER,
  RIGHT_FLIPPER,
  OUTER_WALLS,
  OUTLANE_GUIDES,
} from "./layout";
import { Flipper } from "./flipper";

const { Engine, World, Bodies } = Matter;

export const CATEGORY_BALL = 0x0002;
export const CATEGORY_WORLD = 0x0001;
export const CATEGORY_BUILDING = 0x0004;

export class PinballWorld {
  engine: Matter.Engine;
  world: Matter.World;
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  buildingBodies: Matter.Body[] = [];
  balls: Matter.Body[] = [];

  constructor() {
    this.engine = Engine.create();
    this.engine.gravity.y = 1.0;
    // Extra solver iterations for more reliable resolution against the
    // fast-snapping flipper bodies (default is 6/4).
    this.engine.positionIterations = 12;
    this.engine.velocityIterations = 10;
    this.world = this.engine.world;

    this.buildStaticTable();

    this.leftFlipper = new Flipper(LEFT_FLIPPER);
    this.rightFlipper = new Flipper(RIGHT_FLIPPER);
    World.add(this.world, [this.leftFlipper.body, this.rightFlipper.body]);

    for (const slot of BUILDING_SLOTS) {
      const v = BUILDING_VARIANTS[slot.variant];
      const body = Bodies.rectangle(slot.x, slot.y, v.width, v.height, {
        isStatic: true,
        label: "building",
        restitution: 0.7,
        chamfer: { radius: v.cornerRadius },
      });
      this.buildingBodies.push(body);
    }
    World.add(this.world, this.buildingBodies);
  }

  private buildStaticTable() {
    const walls: Matter.Body[] = [];
    const opts: Matter.IChamferableBodyDefinition = { isStatic: true, label: "wall", restitution: 0.4 };

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

    World.add(this.world, walls);
  }

  spawnBall(x = TABLE_W / 2, y = 60): Matter.Body {
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.55,
      friction: 0.02,
      frictionAir: 0.0008,
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
  }
}
