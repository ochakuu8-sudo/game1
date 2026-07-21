import { Application, Container, Graphics, Sprite } from "pixi.js";
import Matter from "matter-js";
import { buildAtlas, type Atlas } from "../core/atlas";
import { InputManager } from "../core/input";
import { sfx } from "../core/audio";
import { PALETTE } from "../core/palette";
import { PinballWorld } from "../physics/world";
import { Building } from "../entities/building";
import { HumanSwarm } from "../entities/human";
import { ParticleFX } from "../fx/particles";
import { PowerUpManager, type PowerUpChoice } from "./powerups";
import { PowerUpSelect } from "./powerupSelect";
import { BuildingSelect } from "./buildingSelect";
import { BUILDING_TYPES, DEFAULT_BUILDING_TYPE, pickBuildingChoices, type BuildingType } from "../entities/buildingTypes";
import { HUD } from "./hud";
import { buildTableVisuals } from "../physics/tableVisuals";
import {
  TABLE_W, TABLE_H, BUILDING_SLOTS, DRAIN_Y, BALL_RADIUS, HUMAN_RADIUS,
  GRID_COLS, GRID_ROWS, GRID_LEFT, GRID_TOP, GRID_RIGHT, GRID_BOTTOM,
} from "../physics/layout";

type GameState = "title" | "playing" | "gameover" | "powerup" | "building";

// Physics runs at 120Hz (double the render rate) so the flipper - which
// snaps its angle/position directly rather than being driven by forces -
// and fast balls move a shorter distance per discrete step. Matter has no
// continuous collision detection, so large per-step movement is what let
// the ball tunnel straight through the flipper.
const STEP_MS = 1000 / 120;
const MAX_STEPS_PER_FRAME = 10;
const INITIAL_BALLS = 4;
const MULTIBALL_START_THRESHOLD = 8;
const MULTIBALL_GROWTH = 6;
const MULTIBALL_BALL_CAP = 6;
const POWERUP_EVERY_N_BUILDINGS = 3;
// The city starts with only a couple of lots built; the rest trickle in
// over time (see Game.scheduleBuildingSpawns) instead of the whole grid
// being full from the first frame.
const STARTER_BUILDING_MIN = 2;
const STARTER_BUILDING_MAX = 3;
const BUILDING_SPAWN_INTERVAL = 2.2;
const BUILDING_SPAWN_JITTER = 1.1;
// Score-attack stage quotas: stage N needs this many *total* points to
// clear. Linear growth for now - tune these two once there's real playtest
// data on how fast score actually climbs.
const STAGE_QUOTA_BASE = 800;
const STAGE_QUOTA_STEP = 700;
const stageQuota = (stage: number) => STAGE_QUOTA_BASE + (stage - 1) * STAGE_QUOTA_STEP;

export class Game {
  private app: Application;
  private atlas: Atlas;
  private world: PinballWorld;
  private input: InputManager;
  private hud: HUD;
  private humans: HumanSwarm;
  private fx: ParticleFX;
  private powerups: PowerUpManager;
  private powerupSelect: PowerUpSelect;
  private buildingSelect: BuildingSelect;
  private currentBuildingType: BuildingType = DEFAULT_BUILDING_TYPE;

  private root: Container;
  private ballLayer: Container;
  private flipperSprites: { left: Sprite; right: Sprite };
  private buildings: Building[] = [];
  private buildingByBody = new Map<Matter.Body, Building>();
  private ballSprites = new Map<Matter.Body, Sprite>();

  private state: GameState = "title";
  private score = 0;
  private stage = 1;
  private stageTarget = stageQuota(1);
  private ballsReserve = INITIAL_BALLS;
  private humanKills = 0;
  private multiballThreshold = MULTIBALL_START_THRESHOLD;
  private buildingsDestroyedTotal = 0;
  private accumulator = 0;
  private debugFlipperCollisions = 0;
  private debugStepVel: Array<{ x: number; y: number; px: number; py: number }> = [];

  constructor(app: Application) {
    this.app = app;
    this.atlas = buildAtlas(app.renderer);
    this.world = new PinballWorld();
    this.humans = new HumanSwarm(this.atlas);
    this.fx = new ParticleFX(this.atlas);
    this.powerups = new PowerUpManager();
    this.powerupSelect = new PowerUpSelect(this.atlas);
    this.buildingSelect = new BuildingSelect(this.atlas);
    this.hud = new HUD();

    this.root = new Container();
    app.stage.addChild(this.root);

    this.root.addChild(this.buildCityBackdrop());
    this.root.addChild(buildTableVisuals());

    const buildingLayer = new Container();
    this.root.addChild(buildingLayer);
    BUILDING_SLOTS.forEach((slot, i) => {
      const body = this.world.buildingBodies[i];
      const b = new Building(this.atlas, slot, body, () => this.currentBuildingType);
      this.buildings.push(b);
      this.buildingByBody.set(body, b);
      buildingLayer.addChild(b.container);
    });
    this.scheduleBuildingSpawns();

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
    this.root.addChild(this.powerupSelect.container);
    this.root.addChild(this.buildingSelect.container);

    this.input = new InputManager(app.canvas as HTMLCanvasElement);
    this.input.onTap(() => {
      sfx.unlock();
      this.handleTap();
    });

    Matter.Events.on(this.world.engine, "collisionStart", (evt) => this.onCollisionStart(evt));

    this.hud.showTitle();
    this.hud.setScore(0);
    this.hud.setBalls(this.ballsReserve, 0);
    this.hud.setCombo(0, this.multiballThreshold);

    app.ticker.add((ticker) => this.tick(ticker.deltaMS));
  }

  private buildCityBackdrop(): Container {
    const c = new Container();
    const g = new Graphics();
    // A blocky Famicom-style top-down city: flat sky, a walled town square,
    // and a pixel skyline silhouette along the horizon - every shape a
    // g.rect() block, no gradients/circles/ellipses.
    g.rect(0, 0, TABLE_W, TABLE_H).fill(PALETTE.sky);

    // Town square block.
    g.rect(12, 48, TABLE_W - 24, 430).fill(PALETTE.ink);
    g.rect(18, 54, TABLE_W - 36, 410).fill(PALETTE.street);
    g.rect(18, 54, TABLE_W - 36, 410).stroke({ width: 2, color: PALETTE.streetLine, alpha: 0.5 });

    // Narrow streets separate every lot in the fully-packed building grid.
    for (let col = 0; col <= GRID_COLS; col++) {
      const x = GRID_LEFT + ((GRID_RIGHT - GRID_LEFT) * col) / GRID_COLS;
      g.rect(x - 3, 54, 6, 410).fill(PALETTE.streetLine);
    }
    for (let row = 0; row <= GRID_ROWS; row++) {
      const y = GRID_TOP + ((GRID_BOTTOM - GRID_TOP) * row) / GRID_ROWS;
      g.rect(26, y - 3, TABLE_W - 52, 6).fill(PALETTE.streetLine);
    }

    // Distant skyline silhouette along the horizon strip below the town
    // square, like a classic 8-bit background layer, plus a blocky sun and
    // a couple of blocky clouds in the open sky beneath it.
    const horizonY = 500;
    let skylineX = 0;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 1000) / 1000;
    };
    while (skylineX < TABLE_W) {
      const w = 14 + Math.floor(rand() * 10);
      const h = 10 + Math.floor(rand() * 26);
      g.rect(skylineX, horizonY - h, w, h).fill(PALETTE.skyDeep);
      skylineX += w + 3;
    }
    g.rect(0, horizonY, TABLE_W, 4).fill(PALETTE.skyDeep);

    const sunX = TABLE_W * 0.82;
    g.rect(sunX - 16, horizonY - 68, 32, 32).fill(PALETTE.gold);
    g.rect(sunX - 16, horizonY - 68, 32, 32).stroke({ width: 2, color: PALETTE.ink });

    const cloud = (cx: number, cy: number) => {
      g.rect(cx - 16, cy, 32, 8).fill(PALETTE.paper);
      g.rect(cx - 8, cy - 6, 20, 8).fill(PALETTE.paper);
    };
    cloud(70, horizonY + 45);
    cloud(TABLE_W - 70, horizonY + 140);
    cloud(TABLE_W * 0.5, horizonY + 195);

    c.addChild(g);
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
        // No scripted kick here - the flipper reports its own real
        // instantaneous velocity to Matter every step (see
        // physics/flipper.ts), so the engine's native collision response
        // already transfers realistic momentum to the ball on its own,
        // the same way an actual moving flipper arm would. This counter
        // is kept only for the debug/test hooks below.
        this.debugFlipperCollisions++;
        const flipper = other === this.world.leftFlipper.body ? this.world.leftFlipper : this.world.rightFlipper;
        sfx.flipperHit(flipper.held);
      }
    }
  }

  private handleBuildingHit(buildingBody: Matter.Body, ball: Matter.Body) {
    const building = this.buildingByBody.get(buildingBody);
    if (!building || building.destroyed) return;

    const dx = ball.position.x - buildingBody.position.x;
    const dy = ball.position.y - buildingBody.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    const kick = 4.2 * this.powerups.kickForceMultiplier;
    Matter.Body.setVelocity(ball, {
      x: ball.velocity.x + (dx / dist) * kick,
      y: ball.velocity.y + (dy / dist) * kick,
    });

    this.fx.hitSpark(ball.position.x, ball.position.y);
    const destroyed = building.hit();

    if (destroyed) {
      sfx.buildingDestroy();
      this.world.setBuildingActive(buildingBody, false);
      this.addScore(building.type.score);
      this.fx.buildingCollapse(buildingBody.position.x, buildingBody.position.y);
      const range = building.type.humanMax - building.type.humanMin;
      const humanCount = building.type.humanMin + Math.floor(Math.random() * (range + 1));
      this.humans.spawnGroup(buildingBody.position.x, buildingBody.position.y, humanCount);
      this.buildingsDestroyedTotal++;
      if (this.buildingsDestroyedTotal % POWERUP_EVERY_N_BUILDINGS === 0) {
        this.awardPowerup();
      }
    } else {
      sfx.buildingHit();
      this.addScore(building.type.hitScore);
    }
  }

  private awardPowerup() {
    const choices = this.powerups.grantChoices(3);
    if (choices.length === 0) {
      // Every buff is already maxed out - fall back to a flat score bonus.
      this.addScore(300);
      return;
    }
    this.state = "powerup";
    this.powerupSelect.show(choices, (choice) => this.onPowerupChosen(choice));
  }

  private onPowerupChosen(choice: PowerUpChoice) {
    sfx.powerupPick();
    this.powerups.applyChoice(choice.type);
    if (choice.type === "EXTRA_BALL") {
      this.ballsReserve++;
      this.hud.setBalls(this.ballsReserve, this.world.balls.length);
    }
    this.hud.showBanner(choice.label);
    this.state = "playing";
  }

  /** Offers a building-type pick at the start of every stage (including
   * the very first) - see entities/buildingTypes.ts. Pauses play the same
   * way the power-up card does; if a ball is already in flight (a
   * mid-stage clear) it's left exactly where it was and simply resumes,
   * otherwise (game start) a fresh one is served once a card is picked. */
  private beginStage() {
    const choices = pickBuildingChoices(3);
    this.state = "building";
    this.buildingSelect.show(choices, (type) => this.onBuildingChosen(type));
  }

  private onBuildingChosen(type: BuildingType) {
    sfx.powerupPick();
    this.currentBuildingType = type;
    this.hud.showBanner(`次の建物: ${type.label}`);
    this.state = "playing";
    if (this.world.balls.length === 0 && this.ballsReserve > 0) {
      this.serveBall();
    }
  }

  /** Hit the current stage's score quota - advance to the next (tougher)
   * one and offer a fresh building-type pick before play resumes. */
  private clearStage() {
    sfx.stageClear();
    this.stage++;
    this.stageTarget = stageQuota(this.stage);
    this.hud.setStage(this.stage, this.stageTarget);
    this.hud.showBanner(`STAGE ${this.stage}`, 1.6);
    this.beginStage();
  }

  private onHumanPop = (x: number, y: number) => {
    sfx.humanPop();
    this.fx.humanPop(x, y);
    this.addScore(25);
    this.humanKills++;
    if (this.humanKills >= this.multiballThreshold) {
      this.triggerMultiball();
    }
    this.hud.setCombo(this.humanKills, this.multiballThreshold);
  };

  private triggerMultiball() {
    sfx.multiball();
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

  private handleTap() {
    if (this.state === "title") {
      this.startGame();
    } else if (this.state === "gameover") {
      this.startGame();
    } else if (this.state === "playing" && this.world.balls.length === 0 && this.ballsReserve > 0) {
      this.serveBall();
    }
  }

  private serveBall() {
    sfx.launch();
    this.ballsReserve--;
    const body = this.world.spawnBall(TABLE_W / 2, 60);
    this.attachBallSprite(body);
    this.hud.setLaunchHint(false);
    this.hud.setBalls(this.ballsReserve, this.world.balls.length);
  }

  /** Picks a couple of random lots to build immediately and staggers the
   * rest to spawn in one at a time over the following minutes, in a
   * shuffled (not row-by-row) order, instead of the whole grid starting
   * full. Reused both on first load and on every subsequent restart. */
  private scheduleBuildingSpawns() {
    const order = this.buildings.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const starterCount = STARTER_BUILDING_MIN + Math.floor(Math.random() * (STARTER_BUILDING_MAX - STARTER_BUILDING_MIN + 1));
    order.forEach((buildingIndex, pos) => {
      const b = this.buildings[buildingIndex];
      if (pos < starterCount) {
        b.spawn(1);
        this.world.setBuildingActive(b.body, true);
      } else {
        const delay = (pos - starterCount) * BUILDING_SPAWN_INTERVAL + Math.random() * BUILDING_SPAWN_JITTER;
        b.scheduleSpawn(delay);
        this.world.setBuildingActive(b.body, false);
      }
    });
  }

  private startGame() {
    for (const body of [...this.world.balls]) this.removeBallEntity(body);
    this.scheduleBuildingSpawns();
    this.humans.reset();
    this.powerups = new PowerUpManager();
    this.currentBuildingType = DEFAULT_BUILDING_TYPE;

    this.score = 0;
    this.stage = 1;
    this.stageTarget = stageQuota(1);
    this.ballsReserve = INITIAL_BALLS;
    this.humanKills = 0;
    this.multiballThreshold = MULTIBALL_START_THRESHOLD;
    this.buildingsDestroyedTotal = 0;

    this.hud.hideTitle();
    this.hud.hideGameOver();
    this.hud.setScore(0);
    this.hud.setStage(this.stage, this.stageTarget);
    this.hud.setCombo(0, this.multiballThreshold);

    this.beginStage();
  }

  private gameOver() {
    sfx.gameOver();
    this.state = "gameover";
    this.hud.setLaunchHint(false);
    this.hud.showGameOver(this.score);
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

    // Checked once per "playing" frame (rather than inline where addScore
    // is called) so it naturally waits its turn behind any other modal
    // that's already up - once that resolves and state is back to
    // "playing", the very next tick sees the already-over-target score and
    // clears the stage then, no separate pending-flag bookkeeping needed.
    if (this.score >= this.stageTarget) {
      this.clearStage();
      return;
    }

    this.world.leftFlipper.setHeld(this.input.left);
    this.world.rightFlipper.setHeld(this.input.right);
    this.world.leftFlipper.speedMultiplier = this.powerups.flipperPowerMultiplier;
    this.world.rightFlipper.speedMultiplier = this.powerups.flipperPowerMultiplier;

    this.accumulator += dtMs;
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(STEP_MS);
      this.accumulator -= STEP_MS;
      steps++;
      if (import.meta.env.DEV) {
        const b = this.world.balls[0];
        if (b) {
          this.debugStepVel.push({ x: b.velocity.x, y: b.velocity.y, px: b.position.x, py: b.position.y });
          if (this.debugStepVel.length > 2000) this.debugStepVel.shift();
        }
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const dt = dtMs / 1000;

    const catchRadius = BALL_RADIUS + HUMAN_RADIUS + 10 + this.powerups.catchRadiusBonus;
    const ballPositions = this.world.balls.map((b) => ({ x: b.position.x, y: b.position.y }));
    this.humans.update(dt, ballPositions, catchRadius, this.onHumanPop);

    this.fx.update(dt);

    for (const b of this.buildings) {
      if (b.update(dt) === "rebuilt") this.world.setBuildingActive(b.body, true);
    }

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
      if (body.position.y > DRAIN_Y) {
        sfx.drain();
        this.removeBallEntity(body);
      }
    }

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
      buildingStats: () => ({ active: this.buildings.filter((b) => !b.destroyed).length, total: this.buildings.length }),
      forceSpawnAll: () => { for (const b of this.buildings) { b.spawn(1); this.world.setBuildingActive(b.body, true); } },
      buildingInfo: (i: number) => { const b = this.buildings[i]; return b ? { hp: b.hp, destroyed: b.destroyed, visible: b.container.visible, alpha: b.container.alpha, scale: b.container.scale.x } : null; },
      stepVelHistory: () => { const h = this.debugStepVel; this.debugStepVel = []; return h; },
      forceMultiball: () => this.triggerMultiball(),
      setFlipperStacks: (n: number) => { this.powerups.stacks.FLIPPER = n; },
      currentBuildingType: () => this.currentBuildingType.id,
      forceBuildingType: (id: string) => {
        const t = BUILDING_TYPES.find((t) => t.id === id);
        if (t) this.currentBuildingType = t;
      },
      forceBuildingChoice: () => this.beginStage(),
      stage: () => this.stage,
      stageTarget: () => this.stageTarget,
      forceStageClear: () => this.clearStage(),
      serveBall: () => this.serveBall(),
      forceGameOver: () => this.gameOver(),
      state: () => this.state,
      score: () => this.score,
      humanAliveCount: () => this.humans.aliveCount,
      humanDebug: () => this.humans.debugSlots(),
      ballCount: () => this.world.balls.length,
      reserve: () => this.ballsReserve,
      ballPositions: () => this.world.balls.map((b) => ({ x: b.position.x, y: b.position.y })),
      ballVelocities: () => this.world.balls.map((b) => ({ x: b.velocity.x, y: b.velocity.y })),
      teleportBall: (x: number, y: number, vx = 0, vy = 0) => {
        const b = this.world.balls[0];
        if (!b) return;
        Matter.Body.setPosition(b, { x, y });
        Matter.Body.setVelocity(b, { x: vx, y: vy });
      },
      flipperCollisions: () => this.debugFlipperCollisions,
      flipperAngles: () => ({ left: this.world.leftFlipper.currentAngle, right: this.world.rightFlipper.currentAngle }),
      flipperHeld: () => ({ left: this.world.leftFlipper.held, right: this.world.rightFlipper.held, inputLeft: this.input.left, inputRight: this.input.right }),
      flipperDrift: () => {
        const check = (f: typeof this.world.leftFlipper) => {
          const { pivot, length } = f.layout;
          const expectedX = pivot.x + Math.cos(f.currentAngle) * (length / 2);
          const expectedY = pivot.y + Math.sin(f.currentAngle) * (length / 2);
          const dx = f.body.position.x - expectedX;
          const dy = f.body.position.y - expectedY;
          return Math.hypot(dx, dy);
        };
        return { left: check(this.world.leftFlipper), right: check(this.world.rightFlipper) };
      },
    };
  }
}
