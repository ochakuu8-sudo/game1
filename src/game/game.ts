import { Application, Container, Graphics, Sprite } from "pixi.js";
import Matter from "matter-js";
import { buildAtlas, type Atlas } from "../core/atlas";
import { InputManager } from "../core/input";
import { PinballWorld } from "../physics/world";
import { Building } from "../entities/building";
import { HumanSwarm } from "../entities/human";
import { ParticleFX } from "../fx/particles";
import { PowerUpManager, CLASS_POOL, type KaijuClass, type KaijuClassInfo, type PowerUpChoice } from "./powerups";
import { HUD } from "./hud";
import { TABLE_W, TABLE_H, BUILDING_SLOTS, DRAIN_Y, BALL_RADIUS, HUMAN_RADIUS } from "../physics/layout";

type GameState = "title" | "classSelect" | "playing" | "floorClear" | "gameover";

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5;
const INITIAL_BALLS = 4;
const MULTIBALL_START_THRESHOLD = 8;
const MULTIBALL_GROWTH = 6;
const MULTIBALL_BALL_CAP = 6;
const BOSS_FLOOR_INTERVAL = 3;

export class Game {
  private app: Application;
  private atlas: Atlas;
  private world: PinballWorld;
  private input: InputManager;
  private hud: HUD;
  private humans: HumanSwarm;
  private fx: ParticleFX;
  private powerups: PowerUpManager;

  private root: Container;
  private ballLayer: Container;
  private flipperSprites: { left: Sprite; right: Sprite };
  private buildings: Building[] = [];
  private buildingByBody = new Map<Matter.Body, Building>();
  private ballSprites = new Map<Matter.Body, Sprite>();

  private state: GameState = "title";
  private score = 0;
  private ballsReserve = INITIAL_BALLS;
  private humanKills = 0;
  private multiballThreshold = MULTIBALL_START_THRESHOLD;
  private buildingsDestroyedTotal = 0;
  private accumulator = 0;

  private floor = 1;
  private buildingsRemaining = 0;
  private bossFloorActive = false;
  private pendingChoices: PowerUpChoice[] = [];

  constructor(app: Application) {
    this.app = app;
    this.atlas = buildAtlas(app.renderer);
    this.world = new PinballWorld();
    this.humans = new HumanSwarm(this.atlas);
    this.fx = new ParticleFX(this.atlas);
    this.powerups = new PowerUpManager();
    this.hud = new HUD();

    this.root = new Container();
    app.stage.addChild(this.root);

    const bg = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill(0x0d0f1a);
    this.root.addChild(bg);
    this.root.addChild(this.buildKaijuBackdrop());

    const buildingLayer = new Container();
    this.root.addChild(buildingLayer);
    BUILDING_SLOTS.forEach((slot, i) => {
      const body = this.world.buildingBodies[i];
      const b = new Building(this.atlas, slot, body);
      this.buildings.push(b);
      this.buildingByBody.set(body, b);
      buildingLayer.addChild(b.container);
    });

    this.root.addChild(this.humans.container);

    this.ballLayer = new Container();
    this.root.addChild(this.ballLayer);

    this.root.addChild(this.fx.debris.container, this.fx.smoke.container, this.fx.spark.container);

    this.flipperSprites = { left: new Sprite(this.atlas.flipper), right: new Sprite(this.atlas.flipper) };
    for (const s of [this.flipperSprites.left, this.flipperSprites.right]) {
      s.anchor.set(this.atlas.flipperAnchor.x, this.atlas.flipperAnchor.y);
      this.root.addChild(s);
    }
    this.flipperSprites.left.position.set(this.world.leftFlipper.layout.pivot.x, this.world.leftFlipper.layout.pivot.y);
    this.flipperSprites.right.position.set(this.world.rightFlipper.layout.pivot.x, this.world.rightFlipper.layout.pivot.y);

    this.root.addChild(this.hud.container);

    this.input = new InputManager(app.canvas as HTMLCanvasElement);
    this.input.onTap(() => this.handleTap());
    this.input.onTapPos((x, y) => this.handleTap(x, y));

    Matter.Events.on(this.world.engine, "collisionStart", (evt) => this.onCollisionStart(evt));

    this.hud.showTitle();
    this.hud.setScore(0);
    this.hud.setBalls(this.ballsReserve, 0);
    this.hud.setCombo(0, this.multiballThreshold);

    app.ticker.add((ticker) => this.tick(ticker.deltaMS));
  }

  private buildKaijuBackdrop(): Container {
    // Big translucent kaiju silhouette looming behind the skyline - pure
    // decoration, one Graphics object regardless so it doesn't cost extra
    // draw calls beyond what a single sprite would.
    const c = new Container();
    const g = new Graphics();
    const cx = TABLE_W / 2;
    g.ellipse(cx, 150, 92, 120).fill({ color: 0x1c2b22, alpha: 0.5 });
    g.circle(cx, 40, 58).fill({ color: 0x1c2b22, alpha: 0.5 });
    g.poly([cx - 30, 0, cx - 10, -34, cx + 4, 2]).fill({ color: 0x1c2b22, alpha: 0.5 });
    g.poly([cx + 10, 0, cx + 30, -30, cx + 40, 6]).fill({ color: 0x1c2b22, alpha: 0.5 });
    g.circle(cx - 20, 34, 6).fill({ color: 0xff5a3c, alpha: 0.65 });
    g.circle(cx + 20, 34, 6).fill({ color: 0xff5a3c, alpha: 0.65 });
    c.addChild(g);
    c.alpha = 0.8;
    return c;
  }

  private onCollisionStart(evt: Matter.IEventCollision<Matter.Engine>) {
    if (this.state !== "playing") return;
    for (const pair of evt.pairs) {
      const { bodyA, bodyB } = pair;
      const ball = bodyA.label === "ball" ? bodyA : bodyB.label === "ball" ? bodyB : null;
      const other = ball === bodyA ? bodyB : bodyA;
      if (!ball) continue;

      if (other.label === "building") {
        this.handleBuildingHit(other, ball);
      } else if (other.label === "flipper") {
        const flipper = other === this.world.leftFlipper.body ? this.world.leftFlipper : this.world.rightFlipper;
        if (flipper.held) {
          const dx = ball.position.x - flipper.layout.pivot.x;
          const dy = ball.position.y - flipper.layout.pivot.y;
          const dist = Math.hypot(dx, dy) || 1;
          const boost = 2.4 * this.powerups.flipperPowerMultiplier;
          Matter.Body.setVelocity(ball, {
            x: ball.velocity.x + (dx / dist) * boost,
            y: ball.velocity.y + (dy / dist) * boost,
          });
        }
      }
    }
  }

  private handleBuildingHit(buildingBody: Matter.Body, ball: Matter.Body) {
    const building = this.buildingByBody.get(buildingBody);
    if (!building || building.destroyed) return;

    const dx = ball.position.x - buildingBody.position.x;
    const dy = ball.position.y - buildingBody.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    const kick = 5.5 * this.powerups.kickForceMultiplier;
    Matter.Body.setVelocity(ball, {
      x: ball.velocity.x + (dx / dist) * kick,
      y: ball.velocity.y + (dy / dist) * kick,
    });

    this.fx.hitSpark(ball.position.x, ball.position.y);
    const destroyed = building.hit();

    if (destroyed) {
      this.addScore(150);
      this.fx.buildingCollapse(buildingBody.position.x, buildingBody.position.y);
      const humanCount = Math.min(3 + Math.floor(this.buildingsDestroyedTotal / 3), 8);
      this.humans.spawnGroup(buildingBody.position.x, buildingBody.position.y, humanCount);
      this.buildingsDestroyedTotal++;
      this.buildingsRemaining--;

      if (Math.random() < this.powerups.salvageChance) {
        this.ballsReserve++;
        this.hud.showBanner("SALVAGE! +1 BALL", 1.0);
      }

      this.hud.setBuildingsRemaining(this.buildingsRemaining, this.buildings.length, this.floor, this.bossFloorActive);
      this.hud.setBalls(this.ballsReserve, this.world.balls.length);

      if (this.buildingsRemaining <= 0) {
        this.onFloorClear();
      }
    } else {
      this.addScore(10);
    }
  }

  private popHuman(x: number, y: number, scoreValue: number) {
    this.fx.humanPop(x, y);
    this.addScore(scoreValue);
    this.humanKills++;
    if (!this.bossFloorActive && this.humanKills >= this.multiballThreshold) {
      this.triggerMultiball();
    }
    this.hud.setCombo(this.humanKills, this.multiballThreshold);
  }

  private onHumanPop = (x: number, y: number) => {
    this.popHuman(x, y, 25);
    const chainR = this.powerups.chainRadius;
    if (chainR > 0) {
      this.humans.popInRadius(x, y, chainR, (cx, cy) => this.popHuman(cx, cy, 15));
    }
  };

  private triggerMultiball() {
    this.multiballThreshold += MULTIBALL_GROWTH;
    this.humanKills = 0;
    this.addScore(100);
    this.hud.showBanner("MULTIBALL!!", 1.6);
    const spawnCount = Math.min(2, Math.max(0, MULTIBALL_BALL_CAP - this.world.balls.length));
    for (let i = 0; i < spawnCount; i++) {
      const body = this.world.spawnBall(TABLE_W / 2 + (Math.random() - 0.5) * 60, 70);
      Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 6, y: 2 });
      this.attachBallSprite(body);
    }
  }

  private attachBallSprite(body: Matter.Body) {
    const sprite = new Sprite(this.atlas.ball);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = BALL_RADIUS * 2;
    this.ballLayer.addChild(sprite);
    this.ballSprites.set(body, sprite);
  }

  private addScore(base: number) {
    this.score += Math.round(base * this.powerups.scoreMultiplier);
    this.hud.setScore(this.score);
  }

  /** Unified tap handler: pointer taps pass a table-space position, keyboard taps don't. */
  private handleTap(x?: number, y?: number) {
    if (this.state === "title" || this.state === "gameover") {
      this.state = "classSelect";
      this.hud.hideTitle();
      this.hud.hideGameOver();
      this.hud.clearBanner();
      this.hud.showChoices(
        "怪獣を選べ",
        CLASS_POOL.map((c) => ({ label: c.label, desc: c.desc })),
      );
    } else if (this.state === "classSelect") {
      if (x === undefined || y === undefined) return;
      const idx = this.hud.hitTestChoice(x, y);
      if (idx !== null) this.selectClass(CLASS_POOL[idx]);
    } else if (this.state === "floorClear") {
      if (x === undefined || y === undefined) return;
      const idx = this.hud.hitTestChoice(x, y);
      if (idx !== null) this.selectRelic(this.pendingChoices[idx]);
    } else if (this.state === "playing" && this.world.balls.length === 0 && this.ballsReserve > 0) {
      this.serveBall();
    }
  }

  private selectClass(info: KaijuClassInfo) {
    this.hud.hideChoices();
    this.startRun(info.type);
  }

  private startRun(cls: KaijuClass) {
    for (const body of [...this.world.balls]) this.removeBallEntity(body);
    this.humans.reset();
    this.powerups = new PowerUpManager();
    this.powerups.applyClass(cls);

    this.score = 0;
    this.ballsReserve = INITIAL_BALLS;
    this.humanKills = 0;
    this.multiballThreshold = MULTIBALL_START_THRESHOLD;
    this.buildingsDestroyedTotal = 0;
    this.floor = 1;

    this.hud.setScore(0);
    this.hud.setCombo(0, this.multiballThreshold);

    this.state = "playing";
    this.beginFloor();
    this.serveBall();
  }

  private beginFloor() {
    this.bossFloorActive = this.floor % BOSS_FLOOR_INTERVAL === 0;
    const baseLevel = this.floor + 2;
    const level = this.bossFloorActive ? baseLevel + 3 : baseLevel;
    for (const b of this.buildings) b.spawn(level);
    this.buildingsRemaining = this.buildings.length;
    this.hud.setBuildingsRemaining(this.buildingsRemaining, this.buildings.length, this.floor, this.bossFloorActive);
    this.hud.showBanner(
      this.bossFloorActive ? `FLOOR ${this.floor}\n司令部強襲！マルチボール封印` : `FLOOR ${this.floor}`,
      1.8,
    );
  }

  private onFloorClear() {
    this.state = "floorClear";
    this.ballsReserve += 1;
    this.addScore(300 * this.floor);
    this.hud.setBalls(this.ballsReserve, this.world.balls.length);
    this.hud.clearBanner();
    this.pendingChoices = this.powerups.offerChoices(3);
    this.hud.showChoices(
      `FLOOR ${this.floor} CLEAR!`,
      this.pendingChoices.map((c) => ({ label: c.label, desc: c.desc })),
    );
  }

  private selectRelic(choice: PowerUpChoice) {
    this.powerups.apply(choice);
    if (choice.type === "EXTRA_BALL") {
      this.ballsReserve++;
      this.hud.setBalls(this.ballsReserve, this.world.balls.length);
    }
    this.hud.hideChoices();
    this.hud.showBanner(choice.label, 1.0);
    this.floor++;
    this.state = "playing";
    this.beginFloor();
  }

  private serveBall() {
    this.ballsReserve--;
    const body = this.world.spawnBall(TABLE_W / 2, 60);
    this.attachBallSprite(body);
    this.hud.setLaunchHint(false);
    this.hud.setBalls(this.ballsReserve, this.world.balls.length);
  }

  private gameOver() {
    this.state = "gameover";
    this.hud.setLaunchHint(false);
    this.hud.clearBanner();
    this.hud.showGameOver(this.score, this.floor);
  }

  private removeBallEntity(body: Matter.Body) {
    const sprite = this.ballSprites.get(body);
    if (sprite) {
      sprite.destroy();
      this.ballSprites.delete(body);
    }
    this.world.removeBall(body);
  }

  private tick(dtMs: number) {
    this.hud.update(dtMs / 1000);

    if (this.state !== "playing") return;

    this.world.leftFlipper.setHeld(this.input.left);
    this.world.rightFlipper.setHeld(this.input.right);

    this.accumulator += dtMs;
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(STEP_MS);
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const dt = dtMs / 1000;

    const catchRadius = BALL_RADIUS + HUMAN_RADIUS + 10 + this.powerups.catchRadiusBonus;
    const ballPositions = this.world.balls.map((b) => ({ x: b.position.x, y: b.position.y }));
    this.humans.update(dt, ballPositions, catchRadius, this.onHumanPop);

    this.fx.update(dt);

    for (const b of this.buildings) b.update(dt);

    for (const body of this.world.balls) {
      const sprite = this.ballSprites.get(body);
      if (sprite) {
        sprite.position.set(body.position.x, body.position.y);
        sprite.rotation = body.angle;
      }
    }

    this.flipperSprites.left.rotation = this.world.leftFlipper.currentAngle;
    this.flipperSprites.right.rotation = this.world.rightFlipper.currentAngle;

    for (const body of [...this.world.balls]) {
      if (body.position.y > DRAIN_Y) this.removeBallEntity(body);
    }

    // A same-frame floor clear can flip state away from "playing" above;
    // don't let a stale 0-ball reading trigger game over on that frame.
    if (this.state !== "playing") return;

    if (this.world.balls.length === 0) {
      if (this.ballsReserve > 0) {
        this.hud.setLaunchHint(true);
      } else {
        this.gameOver();
      }
    } else {
      this.hud.setLaunchHint(false);
    }

    this.hud.setBalls(this.ballsReserve, this.world.balls.length);
  }

  /** Dev-only test hooks, not attached to window outside import.meta.env.DEV. */
  debugApi() {
    return {
      destroyBuilding: (i: number) => {
        const b = this.buildings[i];
        if (!b) return;
        while (b.hp > 1) b.hit();
        this.handleBuildingHit(b.body, this.world.balls[0] ?? b.body);
      },
      forceMultiball: () => this.triggerMultiball(),
      forceGameOver: () => this.gameOver(),
      state: () => this.state,
      score: () => this.score,
      floor: () => this.floor,
      humanAliveCount: () => this.humans.aliveCount,
      humanDebug: () => this.humans.debugSlots(),
      ballCount: () => this.world.balls.length,
      reserve: () => this.ballsReserve,
    };
  }
}
