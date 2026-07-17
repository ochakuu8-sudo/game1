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
import { BUILDING_SLOTS, buildingRect } from "../physics/layout";

/**
 * Every visual in the game (buildings, humans, ball, flippers, particles,
 * digits) is baked once into a single shared texture here. Because every
 * Sprite/Particle downstream points at slices of the *same* GPU texture,
 * PixiJS's batch renderer folds them all into a handful of draw calls even
 * when hundreds of humans/particles are on screen at once - important for
 * keeping this smooth on phones.
 */
/** Groups a building's footprint into a texture key - buildings share a
 * texture whenever they're the same pixel size (regardless of which grid
 * slot they came from), so the atlas only bakes one facade per distinct
 * size actually used in physics/layout.ts's BUILDING_SLOTS. */
export function buildingSizeKey(width: number, height: number): string {
  return `${Math.round(width)}x${Math.round(height)}`;
}

export interface Atlas {
  ball: Texture;
  flipper: Texture;
  /** Keyed by buildingSizeKey(width, height) - one facade texture per
   * distinct building footprint size used in the current layout. */
  buildings: Record<string, Texture>;
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

  // --- Ball: the kaiju itself, compressed into a pinball-sized monster head. ---
  place("ball", (g) => {
    g.poly([-19, -15, -12, -29, -3, -18, 8, -30, 17, -13]).fill(0x315d46);
    g.circle(0, 0, 25).fill(0x4c8b5f);
    g.circle(-9, -6, 6).fill(0xffe85c);
    g.circle(9, -6, 6).fill(0xffe85c);
    g.rect(-10, -8, 3, 6).fill(0x151b18);
    g.rect(7, -8, 3, 6).fill(0x151b18);
    g.arc(0, 7, 12, 0.1, Math.PI - 0.1).stroke({ width: 3, color: 0x183326 });
    g.poly([-9, 9, -5, 15, -2, 9, 2, 15, 5, 9, 9, 14]).fill(0xf5efe0);
    g.circle(0, 0, 25).stroke({ width: 3, color: 0x244b36 });
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

  // --- Buildings: one facade texture per distinct footprint size actually
  // used by the grid layout (physics/layout.ts), rather than fixed
  // "wide"/"tower" shapes - so 1x1/1x2/2x1/2x2 (and anything else the grid
  // produces) all get a properly-proportioned window grid. Drawn in white
  // with near-white windows so each building instance can be recoloured
  // with a per-Sprite tint (see entities/building.ts) while keeping the
  // windows reading as a lighter "glass" highlight under any tint.
  const buildingSizes = new Map<string, { w: number; h: number }>();
  for (const slot of BUILDING_SLOTS) {
    const r = buildingRect(slot);
    buildingSizes.set(buildingSizeKey(r.width, r.height), { w: r.width, h: r.height });
  }

  const drawBuildingFacade = (g: Graphics, w: number, h: number) => {
    const r = Math.min(10, w / 6, h / 6);
    g.roundRect(-w / 2, -h / 2, w, h, r).fill(0xffffff);
    g.roundRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14, Math.max(3, r - 3)).fill(0xcdd3d6);
    g.rect(-w * 0.22, -h * 0.18, w * 0.44, h * 0.36).fill(0x8f999d);
    g.rect(-w * 0.16, -h * 0.12, w * 0.32, h * 0.24).fill(0xb8c0c3);
    for (const x of [-w * 0.32, w * 0.32]) g.circle(x, h * 0.28, Math.min(5, w / 14)).fill(0x768186);
    g.roundRect(-w / 2, -h / 2, w, h, r).stroke({ width: 3, color: 0x747d80 });
  };

  // Packed into their own strip (like the flipper) since some spans (e.g.
  // 2x2) are far larger than one CELL and would bleed into neighbours.
  const buildingStripY = ROWS * CELL + FLIPPER_H;
  let buildingStripX = 0;
  let buildingStripH = 0;
  const buildingFrames: Record<string, Rectangle> = {};
  for (const [key, { w, h }] of buildingSizes) {
    const g = new Graphics();
    drawBuildingFacade(g, w, h);
    g.position.set(buildingStripX + w / 2, buildingStripY + h / 2);
    staging.addChild(g);
    buildingFrames[key] = new Rectangle(buildingStripX, buildingStripY, w, h);
    buildingStripX += w + 8;
    buildingStripH = Math.max(buildingStripH, h);
  }

  // --- Top-down human: head, torso, arms and separated walking legs. ---
  place("human", (g) => {
    g.circle(0, -7, 4).fill(0xffd3b0);
    g.roundRect(-4, -3, 8, 10, 3).fill(0xffffff);
    g.moveTo(-3, 0).lineTo(-7, 5).stroke({ width: 2.5, color: 0xffd3b0 });
    g.moveTo(3, 0).lineTo(7, 4).stroke({ width: 2.5, color: 0xffd3b0 });
    g.moveTo(-2, 6).lineTo(-4, 12).stroke({ width: 3, color: 0x263a59 });
    g.moveTo(2, 6).lineTo(5, 11).stroke({ width: 3, color: 0x263a59 });
  }, 32);

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
  const atlasH = ROWS * CELL + FLIPPER_H + buildingStripH;
  const renderTexture = RenderTexture.create({ width: atlasW, height: atlasH, resolution: 2 });
  renderer.render({ container: staging, target: renderTexture });
  staging.destroy({ children: true });

  const slice = (name: string) => new Texture({ source: renderTexture.source, frame: frames[name] });
  const sliceRect = (frame: Rectangle) => new Texture({ source: renderTexture.source, frame });

  const buildings: Record<string, Texture> = {};
  for (const [key, frame] of Object.entries(buildingFrames)) {
    buildings[key] = sliceRect(frame);
  }

  return {
    ball: slice("ball"),
    flipper: slice("flipper"),
    buildings,
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
