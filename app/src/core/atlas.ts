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
  /** Same keys as `buildings` - a "dizzy" (X-eyed) variant flashed briefly
   * on a hit for a cartoon reaction. */
  buildingsDizzy: Record<string, Texture>;
  human: Texture;
  humanRun: Texture;
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

  // --- Ball: a cute round kaiju face - big googly eyes, blush, a happy
  // little fang instead of a menacing monster, for the casual/kawaii look. ---
  place("ball", (g) => {
    g.circle(-13, -21, 6.5).fill(0x8fe0b0);
    g.circle(0, -25, 7.5).fill(0x8fe0b0);
    g.circle(13, -21, 6.5).fill(0x8fe0b0);
    g.circle(0, 0, 25).fill(0x8fe0b0);
    g.circle(-16, 7, 5).fill({ color: 0xff9eb9, alpha: 0.75 });
    g.circle(16, 7, 5).fill({ color: 0xff9eb9, alpha: 0.75 });
    g.circle(-9, -3, 7.5).fill(0xffffff);
    g.circle(9, -3, 7.5).fill(0xffffff);
    g.circle(-7, -1, 4.2).fill(0x2b2b2b);
    g.circle(11, -1, 4.2).fill(0x2b2b2b);
    g.circle(-8.5, -4.5, 1.6).fill(0xffffff);
    g.circle(9.5, -4.5, 1.6).fill(0xffffff);
    g.arc(0, 8, 9, 0.2, Math.PI - 0.2).stroke({ width: 3, color: 0x3a8f63 });
    g.poly([-3, 12, 0, 17, 3, 12]).fill(0xffffff);
    g.circle(0, 0, 25).stroke({ width: 3, color: 0x4bab78 });
  }, 64);

  // --- Flipper: rounded candy-coloured paddle with a glossy highlight,
  // drawn hinge-anchored in its own reserved strip (see FLIPPER_* constants)
  // rather than the shared icon grid ---
  {
    const g = new Graphics();
    g.poly([0, -13, 66, -8, 70, 0, 66, 8, 0, 13]).fill(0xff6f91);
    g.circle(0, 0, 13).fill(0xff6f91);
    g.circle(70, 0, 7).fill(0xff85a3);
    g.ellipse(24, -5, 24, 4.5).fill({ color: 0xffffff, alpha: 0.5 });
    g.poly([0, -13, 66, -8, 70, 0, 66, 8, 0, 13]).stroke({ width: 2, color: 0xd94f74 });
    g.circle(0, 0, 13).stroke({ width: 2, color: 0xd94f74 });
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

  // Retro "arranged rectangles" pixel-art facade - every feature (wall,
  // windows, face) is a flat g.rect() block, no circles/arcs/rounded
  // corners, for a blocky dot-art look. A `dizzy` variant (accent-colour
  // eyes, gap-toothed mouth) is baked alongside the normal one so
  // entities/building.ts can flash it briefly on a hit, like a classic
  // cartoon "OW!" reaction. Colliders/positions are untouched - this only
  // changes what gets drawn into the shared texture.
  const drawBuildingFacade = (g: Graphics, w: number, h: number, dizzy: boolean) => {
    const wall = 0xffffff; // tinted per-instance, see entities/building.ts
    const window = 0xdcf3ff;
    const trim = 0x2b2b2b;
    const eye = dizzy ? 0xff6f91 : 0x2b2b2b;
    const mouth = 0x2b2b2b;

    g.rect(-w / 2, -h / 2, w, h).fill(wall);

    // Roofline trim strip along the top edge.
    g.rect(-w / 2, -h / 2, w, h * 0.06).fill(trim);

    // Two rows of square "pixel" windows, gapped in the middle column so
    // the face beneath has room to read clearly.
    const winSize = Math.min(w, h) * 0.12;
    for (const wy of [-h * 0.32, -h * 0.14]) {
      for (const wx of [-w * 0.3, w * 0.3]) {
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).fill(window);
      }
    }

    // Chunky square-eyed pixel face.
    const eyeSize = Math.min(w, h) * 0.13;
    const eyeY = h * 0.05;
    const eyeSpacing = w * 0.2;
    g.rect(-eyeSpacing - eyeSize / 2, eyeY - eyeSize / 2, eyeSize, eyeSize).fill(eye);
    g.rect(eyeSpacing - eyeSize / 2, eyeY - eyeSize / 2, eyeSize, eyeSize).fill(eye);

    const mouthY = eyeY + eyeSize * 1.6;
    const mouthH = eyeSize * 0.7;
    if (dizzy) {
      // Gap-toothed wobble: alternating short blocks instead of one bar.
      const mouthW = eyeSize * 3.2;
      const seg = mouthW / 5;
      for (let i = 0; i < 5; i += 2) {
        g.rect(-mouthW / 2 + i * seg, mouthY - mouthH / 2, seg, mouthH).fill(mouth);
      }
    } else {
      const mouthW = eyeSize * 2.4;
      g.rect(-mouthW / 2, mouthY - mouthH / 2, mouthW, mouthH).fill(mouth);
    }

    // Flat rectangular outline (no rounded corners) to keep the silhouette
    // blocky against the neighbouring tinted facades.
    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: 0x1c2534, alpha: 0.35 });
  };

  // Packed into their own strip (like the flipper) since some spans (e.g.
  // 2x2) are far larger than one CELL and would bleed into neighbours.
  // Normal and dizzy variants sit side by side per size.
  const buildingStripY = ROWS * CELL + FLIPPER_H;
  let buildingStripX = 0;
  let buildingStripH = 0;
  const buildingFrames: Record<string, Rectangle> = {};
  const dizzyFrames: Record<string, Rectangle> = {};
  for (const [key, { w, h }] of buildingSizes) {
    const g = new Graphics();
    drawBuildingFacade(g, w, h, false);
    g.position.set(buildingStripX + w / 2, buildingStripY + h / 2);
    staging.addChild(g);
    buildingFrames[key] = new Rectangle(buildingStripX, buildingStripY, w, h);
    buildingStripX += w + 8;

    const gd = new Graphics();
    drawBuildingFacade(gd, w, h, true);
    gd.position.set(buildingStripX + w / 2, buildingStripY + h / 2);
    staging.addChild(gd);
    dizzyFrames[key] = new Rectangle(buildingStripX, buildingStripY, w, h);
    buildingStripX += w + 8;

    buildingStripH = Math.max(buildingStripH, h);
  }

  // --- Retro pixel-art panicking pedestrian: every part (head, hair,
  // torso, arms, legs) is a flat g.rect() block instead of circles/lines,
  // for the same "arranged rectangles" dot-art look as the buildings.
  // Two silhouettes (arms/legs swapped via `phase`) are alternated by the
  // swarm for a bouncy, readable "running in a panic" cycle - hit radius
  // and physics are untouched, only the drawing changed. ---
  const drawHuman = (g: Graphics, phase: number) => {
    const skin = 0xffd2ad;
    const hair = 0x3a2a20;
    const shirt = 0xffffff;
    const dark = 0x2b2b2b;
    const limb = 0x3a4a68;

    // ground shadow
    g.rect(-5, 10.5, 10, 2).fill({ color: 0x101820, alpha: 0.25 });

    // legs, kicked out oppositely each frame
    g.rect(-4 - phase * 2.5, 6.5, 2.4, 5).fill(limb);
    g.rect(1.6 + phase * 2.5, 6.5, 2.4, 5).fill(limb);

    // torso block
    g.rect(-3.6, 2, 7.2, 6).fill(shirt);
    g.rect(-3.6, 2, 7.2, 6).stroke({ width: 1, color: limb });

    // arms thrown straight up in a panic
    g.rect(-7.5, -8 + phase, 3, 8).fill(skin);
    g.rect(4.5, -8 - phase, 3, 8).fill(skin);

    // head block + hair cap
    g.rect(-5.5, -12.5, 11, 9).fill(skin);
    g.rect(-6, -13, 12, 3.5).fill(hair);

    // square eyes
    g.rect(-3.6, -8.5, 2.2, 2.2).fill(dark);
    g.rect(1.4, -8.5, 2.2, 2.2).fill(dark);

    // wide-open scream mouth
    g.rect(-1.6, -4.5, 3.2, 3).fill(0x8a4b38);
  };
  place("human", (g) => drawHuman(g, -1), 32);
  place("humanRun", (g) => drawHuman(g, 1), 32);

  // --- Debris chunk (building destruction) - rounded cartoon rubble ---
  place("debris", (g) => {
    g.poly([-7, -5, 6, -7, 8, 5, -5, 7]).fill(0xc9b8a3);
    g.poly([-7, -5, 6, -7, 8, 5, -5, 7]).stroke({ width: 1.5, color: 0x8a7863 });
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
  const buildingsDizzy: Record<string, Texture> = {};
  for (const [key, frame] of Object.entries(dizzyFrames)) {
    buildingsDizzy[key] = sliceRect(frame);
  }

  return {
    ball: slice("ball"),
    flipper: slice("flipper"),
    buildings,
    buildingsDizzy,
    human: slice("human"),
    humanRun: slice("humanRun"),
    debris: slice("debris"),
    spark: slice("spark"),
    smoke: slice("smoke"),
    star: slice("star"),
    ring: slice("ring"),
    digits: digitNames.map(slice),
    flipperAnchor: { x: FLIPPER_HINGE_X / FLIPPER_W, y: FLIPPER_HINGE_Y / FLIPPER_H },
  };
}
