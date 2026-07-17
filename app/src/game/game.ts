import { Application, Container, Graphics, Sprite } from "pixi.js";
import Matter from "matter-js";
import { buildAtlas, type Atlas } from "../core/atlas";
import { InputManager } from "../core/input";
import { PinballWorld } from "../physics/world";
import { Building } from "../entities/building";
import { HumanSwarm } from "../entities/human";
import { ParticleFX } from "../fx/particles";
import { PowerUpManager } from "./powerups";
import { HUD } from "./hud";
import { buildTableVisuals } from "../physics/tableVisuals";
import { TABLE_W, TABLE_H, BUILDING_SLOTS, DRAIN_Y, BALL_RADIUS, HUMAN_RADIUS } from "../physics/layout";

type GameState = "title" | "playing" | "gameover";

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
  private debugFlipperCollisions = 0;
  private debugLastBoost: unknown = null;

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

    this.root.addChild(this.buildCityBackdrop());
    this.root.addChild(buildTableVisuals());

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
    // A top-down city playfield: asphalt surrounds concrete blocks, with a
    // connected street grid instead of a sky behind floating buildings.
    g.rect(0, 0, TABLE_W, TABLE_H).fill(0x303940);
    g.rect(26, 54, TABLE_W - 52, 410).fill(0x667078);
    for (const x of [40, 125, 210, 295, 380]) {
      g.rect(x - 10, 54, 20, 410).fill(0x303940);
      for (let y = 61; y < 455; y += 25) g.rect(x - 1, y, 2, 11).fill({ color: 0xf4d35e, alpha: 0.75 });
    }
    for (const y of [72, 164, 256, 348, 440]) {
      g.rect(26, y - 10, TABLE_W - 52, 20).fill(0x303940);
      for (let x = 32; x < TABLE_W - 28; x += 25) g.rect(x, y - 1, 11, 2).fill({ color: 0xffffff, alpha: 0.5 });
    }
    // Crosswalks make the scale and street direction immediately readable.
    for (const y of [150, 334]) {
      for (let x = 191; x <= 221; x += 6) g.rect(x, y, 3, 18).fill({ color: 0xffffff, alpha: 0.75 });
    }
    // Scorched kaiju footprints tie the destructive ball path to the city.
    for (const [x, y] of [[92, 510], [318, 570]] as const) {
      g.ellipse(x, y, 20, 30).fill({ color: 0x161b1e, alpha: 0.45 });
      g.circle(x - 15, y - 22, 6).fill({ color: 0x161b1e, alpha: 0.4 });
      g.circle(x, y - 28, 6).fill({ color: 0x161b1e, alpha: 0.4 });
      g.circle(x + 15, y - 22, 6).fill({ color: 0x161b1e, alpha: 0.4 });
    }
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
        this.debugFlipperCollisions++;
        const flipper = other === this.world.leftFlipper.body ? this.world.leftFlipper : this.world.rightFlipper;
        if (flipper.held) {
          // The flipper itself carries no velocity (see physics/flipper.ts),
          // so all of its "kick" comes from this explicit boost.
          //
          // Direction: tangent to the flipper's OWN current angle (not the
          // pivot->ball vector). Deriving it from the ball's position is
          // numerically unstable near the hinge - a small radius means any
          // perpendicular offset (the ball sitting slightly off the blade's
          // centerline, which it always is a little, being round) swings
          // the angle wildly, which used to send close-to-hinge hits off in
          // near-random directions. The flipper's own angle has no such
          // issue.
          const angle = flipper.currentAngle;
          const tx = -Math.sin(angle) * flipper.sweepSign;
          const ty = Math.cos(angle) * flipper.sweepSign;

          // Magnitude: real v = ω × r, same as an actual rigid flipper -
          // how far out along the blade the contact is (projected onto the
          // blade's own direction; a hit right at the hinge has almost no
          // leverage) times how fast the flipper is *actually rotating
          // right now*. That second factor is what was missing before: the
          // kick was a flat number regardless of whether the flipper was
          // mid-snap or sitting there already raised, so it didn't feel
          // connected to the flipper's own motion. Catching the ball right
          // as it snaps up now gives a noticeably harder hit than resting
          // it on a flipper that's already up and stopped.
          const relX = ball.position.x - flipper.layout.pivot.x;
          const relY = ball.position.y - flipper.layout.pivot.y;
          const radiusAlongBlade = Math.max(0, Math.min(flipper.layout.length, relX * Math.cos(angle) + relY * Math.sin(angle)));
          const rotationalSpeed = Math.abs(flipper.angularVelocity) * radiusAlongBlade;

          // SET (not add to) the ball's velocity. Adding used to leave the
          // result dominated by whatever momentum the ball already had -
          // gravity and recent bounces routinely gave it more downward
          // speed than a kick's added upward component could overcome, so
          // it kept heading down/sideways right through an
          // apparently-successful flip. Setting it outright makes the
          // flipper always decisively redirect the ball, which is how
          // most arcade-style pinball implementations (not just literal
          // rigid-body transfer) handle this. MIN_KICK is a floor so a
          // ball merely resting on an already-raised, unmoving flipper
          // still gets *something* rather than feeling dead.
          const MIN_KICK = 5.5;
          const KICK_GAIN = 2.2; // tuned for game feel, not physically derived
          const boost = Math.max(MIN_KICK, rotationalSpeed * KICK_GAIN) * this.powerups.flipperPowerMultiplier;
          const newVel = { x: tx * boost, y: ty * boost };
          Matter.Body.setVelocity(ball, newVel);
          this.debugLastBoost = { angle, tx, ty, radiusAlongBlade, angularVelocity: flipper.angularVelocity, boost, resultVel: { ...newVel } };
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
      if (this.buildingsDestroyedTotal % POWERUP_EVERY_N_BUILDINGS === 0) {
        this.awardPowerup();
      }
    } else {
      this.addScore(10);
    }
  }

  private awardPowerup() {
    const choice = this.powerups.grantRandom();
    if (choice.type === "EXTRA_BALL") {
      this.ballsReserve++;
      this.hud.setBalls(this.ballsReserve, this.world.balls.length);
    }
    this.hud.showBanner(choice.label);
  }

  private onHumanPop = (x: number, y: number) => {
    this.fx.humanPop(x, y);
    this.addScore(25);
    this.humanKills++;
    if (this.humanKills >= this.multiballThreshold) {
      this.triggerMultiball();
    }
    this.hud.setCombo(this.humanKills, this.multiballThreshold);
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
    this.ballsReserve--;
    const body = this.world.spawnBall(TABLE_W / 2, 60);
    this.attachBallSprite(body);
    this.hud.setLaunchHint(false);
    this.hud.setBalls(this.ballsReserve, this.world.balls.length);
  }

  private startGame() {
    for (const body of [...this.world.balls]) this.removeBallEntity(body);
    for (const b of this.buildings) b.spawn(3);
    this.humans.reset();
    this.powerups = new PowerUpManager();

    this.score = 0;
    this.ballsReserve = INITIAL_BALLS;
    this.humanKills = 0;
    this.multiballThreshold = MULTIBALL_START_THRESHOLD;
    this.buildingsDestroyedTotal = 0;

    this.hud.hideTitle();
    this.hud.hideGameOver();
    this.hud.setScore(0);
    this.hud.setCombo(0, this.multiballThreshold);

    this.state = "playing";
    this.serveBall();
  }

  private gameOver() {
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
      lastBoost: () => this.debugLastBoost,
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
