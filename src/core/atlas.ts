import {
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Text,
  TextStyle,
  Texture,
  type Renderer,
} from "pixi.js";

/**
 * Every visual in the game (buildings, humans, ball, flippers, particles,
 * digits) is baked once into a single shared texture here. Because every
 * Sprite/Particle downstream points at slices of the *same* GPU texture,
 * PixiJS's batch renderer folds them all into a handful of draw calls even
 * when hundreds of humans/particles are on screen at once - important for
 * keeping this smooth on phones.
 */
export interface Atlas {
  ball: Texture;
  flipper: Texture;
  buildingWide: Texture;
  buildingTower: Texture;
  human: Texture;
  debris: Texture;
  spark: Texture;
  smoke: Texture;
  star: Texture;
  ring: Texture;
  digits: Texture[];
  /** Anchor fraction (0-1) locating the flipper's hinge within its texture. */
  flipperAnchor: { x: number; y: number };
}

const CELL = 128;
const COLS = 8;
const ROWS = 4;

// The flipper is long/thin and drawn hinge-anchored, so it gets its own
// reserved strip below the square icon grid instead of squeezing into one
// CELL (its ~80px length would bleed into the neighbouring atlas tile).
const FLIPPER_W = 160;
const FLIPPER_H = 72;
const FLIPPER_HINGE_X = 22;
const FLIPPER_HINGE_Y = FLIPPER_H / 2;

export function buildAtlas(renderer: Renderer): Atlas {
  const staging = new Container();
  const frames: Record<string, Rectangle> = {};
  let cursor = 0;

  const nextCell = (): { x: number; y: number } => {
    const col = cursor % COLS;
    const row = Math.floor(cursor / COLS);
    cursor++;
    return { x: col * CELL, y: row * CELL };
  };

  const place = (name: string, draw: (g: Graphics) => void, size = CELL) => {
    const { x, y } = nextCell();
    const g = new Graphics();
    draw(g);
    g.position.set(x + CELL / 2, y + CELL / 2);
    staging.addChild(g);
    const half = size / 2;
    frames[name] = new Rectangle(x + CELL / 2 - half, y + CELL / 2 - half, size, size);
  };

  // --- Ball: chrome-ish sphere ---
  place("ball", (g) => {
    g.circle(0, 0, 26).fill(0xe8edf4);
    g.circle(-8, -9, 10).fill(0xffffff);
    g.circle(0, 0, 26).stroke({ width: 2, color: 0x8892a0, alpha: 0.6 });
  }, 64);

  // --- Flipper: tapered paddle, drawn hinge-anchored in its own reserved
  // strip (see FLIPPER_* constants) rather than the shared icon grid ---
  {
    const g = new Graphics();
    g.poly([0, -14, 70, -7, 70, 7, 0, 14]).fill(0xff5a3c);
    g.circle(0, 0, 14).fill(0xff7a55);
    g.circle(70, 0, 7).fill(0xff7a55);
    g.poly([4, -10, 62, -5, 62, -1, 4, -4]).fill(0xffb199);
    g.position.set(FLIPPER_HINGE_X, ROWS * CELL + FLIPPER_HINGE_Y);
    staging.addChild(g);
    frames.flipper = new Rectangle(0, ROWS * CELL, FLIPPER_W, FLIPPER_H);
  }

  // --- Buildings (bumper targets), two silhouettes for variety ---
  place("buildingWide", (g) => {
    g.roundRect(-42, -30, 84, 60, 6).fill(0x3a4a63);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        g.rect(-32 + i * 22, -20 + j * 24, 12, 14).fill(0xffd873);
      }
    }
    g.roundRect(-42, -30, 84, 60, 6).stroke({ width: 3, color: 0x1c2534 });
  });

  place("buildingTower", (g) => {
    g.roundRect(-26, -46, 52, 92, 6).fill(0x4a3a63);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 4; j++) {
        g.rect(-18 + i * 20, -38 + j * 20, 10, 12).fill(0xffd873);
      }
    }
    g.roundRect(-26, -46, 52, 92, 6).stroke({ width: 3, color: 0x241c34 });
  });

  // --- Human: tiny fleeing civilian, simple readable blob ---
  place("human", (g) => {
    g.circle(0, -6, 7).fill(0xffe0b2);
    g.roundRect(-6, -1, 12, 14, 4).fill(0xffffff);
    g.rect(-6, 12, 4, 8).fill(0x2b2b2b);
    g.rect(2, 12, 4, 8).fill(0x2b2b2b);
  }, 48);

  // --- Debris chunk (building destruction) ---
  place("debris", (g) => {
    g.poly([-8, -6, 8, -8, 9, 6, -6, 9]).fill(0x8a93a3);
  }, 32);

  // --- Spark (hit feedback) ---
  place("spark", (g) => {
    g.star(0, 0, 4, 10, 3).fill(0xfff2b0);
  }, 32);

  // --- Smoke puff ---
  place("smoke", (g) => {
    g.circle(0, 0, 16).fill({ color: 0xcfcfd6, alpha: 0.55 });
  }, 48);

  // --- Star (powerup icon) ---
  place("star", (g) => {
    g.star(0, 0, 5, 16, 7).fill(0xffe066);
    g.star(0, 0, 5, 16, 7).stroke({ width: 2, color: 0xc98f00 });
  }, 48);

  // --- Soft glow ring (used for pop/kick fx) ---
  place("ring", (g) => {
    g.circle(0, 0, 20).stroke({ width: 5, color: 0xffffff, alpha: 0.9 });
  }, 48);

  // --- Digits 0-9 for HP labels ---
  const digitStyle = new TextStyle({
    fontFamily: "Arial, sans-serif",
    fontWeight: "900",
    fontSize: 56,
    fill: 0xffffff,
    stroke: { color: 0x14202f, width: 8, join: "round" },
  });
  const digitNames: string[] = [];
  for (let d = 0; d <= 9; d++) {
    const name = `digit${d}`;
    digitNames.push(name);
    const { x, y } = nextCell();
    const t = new Text({ text: String(d), style: digitStyle });
    t.anchor.set(0.5);
    t.position.set(x + CELL / 2, y + CELL / 2);
    staging.addChild(t);
    frames[name] = new Rectangle(x + CELL / 2 - 32, y + CELL / 2 - 32, 64, 64);
  }

  const atlasW = COLS * CELL;
  const atlasH = ROWS * CELL + FLIPPER_H;
  const renderTexture = RenderTexture.create({ width: atlasW, height: atlasH, resolution: 2 });
  renderer.render({ container: staging, target: renderTexture });
  staging.destroy({ children: true });

  const slice = (name: string) => new Texture({ source: renderTexture.source, frame: frames[name] });

  return {
    ball: slice("ball"),
    flipper: slice("flipper"),
    buildingWide: slice("buildingWide"),
    buildingTower: slice("buildingTower"),
    human: slice("human"),
    debris: slice("debris"),
    spark: slice("spark"),
    smoke: slice("smoke"),
    star: slice("star"),
    ring: slice("ring"),
    digits: digitNames.map(slice),
    flipperAnchor: { x: FLIPPER_HINGE_X / FLIPPER_W, y: FLIPPER_HINGE_Y / FLIPPER_H },
  };
}
