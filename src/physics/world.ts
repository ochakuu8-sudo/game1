import Matter from "matter-js";
import { TABLE_W, TABLE_H, WALL_T, LEFT_FLIPPER, RIGHT_FLIPPER, BUILDING_SLOTS, BALL_RADIUS } from "./layout";
import { Flipper } from "./flipper";

const { Engine, World, Bodies, Composite } = Matter;

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
    this.world = this.engine.world;

    this.buildStaticTable();

    this.leftFlipper = new Flipper(LEFT_FLIPPER);
    this.rightFlipper = new Flipper(RIGHT_FLIPPER);
    World.add(this.world, [this.leftFlipper.body, this.rightFlipper.body]);

    for (const slot of BUILDING_SLOTS) {
      const body = Bodies.circle(slot.x, slot.y, slot.radius * 0.72, {
        isStatic: true,
        label: "building",
        restitution: 0.7,
      });
      this.buildingBodies.push(body);
    }
    World.add(this.world, this.buildingBodies);
  }

  private buildStaticTable() {
    const walls: Matter.Body[] = [];
    const opts: Matter.IChamferableBodyDefinition = { isStatic: true, label: "wall", restitution: 0.4 };

    // Left / right outer walls
    walls.push(Bodies.rectangle(WALL_T / 2, TABLE_H / 2, WALL_T, TABLE_H, opts));
    walls.push(Bodies.rectangle(TABLE_W - WALL_T / 2, TABLE_H / 2, WALL_T, TABLE_H, opts));
    // Top wall
    walls.push(Bodies.rectangle(TABLE_W / 2, WALL_T / 2, TABLE_W, WALL_T, opts));

    // Top corner bevels for a rounded "dome" silhouette
    walls.push(Bodies.rectangle(WALL_T + 26, WALL_T + 10, 70, WALL_T, { ...opts, angle: -0.6 }));
    walls.push(Bodies.rectangle(TABLE_W - WALL_T - 26, WALL_T + 10, 70, WALL_T, { ...opts, angle: 0.6 }));

    // Slingshot funnel walls feeding the flippers, mirrored left/right
    const funnelY = TABLE_H - 190;
    walls.push(
      Bodies.fromVertices(
        TABLE_W * 0.16,
        funnelY + 55,
        [
          [
            { x: -WALL_T / 2, y: -80 },
            { x: WALL_T / 2, y: -80 },
            { x: 60, y: 80 },
            { x: 60 - WALL_T, y: 80 },
          ],
        ],
        { ...opts },
        true,
      ),
    );
    walls.push(
      Bodies.fromVertices(
        TABLE_W * 0.84,
        funnelY + 55,
        [
          [
            { x: WALL_T / 2, y: -80 },
            { x: -WALL_T / 2, y: -80 },
            { x: -60, y: 80 },
            { x: -60 + WALL_T, y: 80 },
          ],
        ],
        { ...opts },
        true,
      ),
    );

    // Outer lane walls below the funnels, guarding the flipper gap
    walls.push(Bodies.rectangle(WALL_T / 2 + 6, TABLE_H - 70, WALL_T, 160, opts));
    walls.push(Bodies.rectangle(TABLE_W - WALL_T / 2 - 6, TABLE_H - 70, WALL_T, 160, opts));

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
