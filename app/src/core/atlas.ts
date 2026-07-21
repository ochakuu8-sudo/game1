import { Container, Graphics, Rectangle, RenderTexture, Texture, type Renderer } from "pixi.js";
import { BUILDING_SLOTS, buildingRect } from "../physics/layout";
import { PALETTE } from "./palette";

/**
 * Every visual in the game (buildings, humans, ball, flippers, particles,
 * digits) is baked once into a single shared texture here. Because every
 * Sprite/Particle downstream points at slices of the *same* GPU texture,
 * PixiJS's batch renderer folds them all into a handful of draw calls even
 * when hundreds of humans/particles are on screen at once - important for
 * keeping this smooth on phones.
 *
 * Everything is drawn as flat g.rect() blocks (plus a couple of small
 * helpers that decide *which* cells to fill, e.g. circleBitmap) rather than
 * circles/arcs/rounded corners or a small texture scaled up - a retro,
 * Famicom-style "arranged rectangles" dot-art look baked directly at the
 * atlas's native resolution.
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
  /** Same keys as `buildings` - a "dizzy" variant flashed briefly on a hit
   * for a cartoon reaction. */
  buildingsDizzy: Record<string, Texture>;
  /** Generic fixed-size house icon for the building-type picker card UI. */
  houseIcon: Texture;
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

export type FillColor = number | { color: number; alpha: number };
export type Bitmap = string[];

/** Draws a bitmap ('1' = filled, anything else = skip) as literal adjacent
 * g.rect() blocks - the one shared primitive every sprite below is built
 * from, so the whole atlas reads as one consistent dot-art technique. */
export function blit(g: Graphics, bitmap: Bitmap, px: number, fill: FillColor, originX?: number, originY?: number) {
  const cols = bitmap[0].length;
  const rows = bitmap.length;
  const ox = originX ?? -(cols * px) / 2;
  const oy = originY ?? -(rows * px) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (bitmap[r][c] !== "1") continue;
      g.rect(ox + c * px, oy + r * px, px, px).fill(fill);
    }
  }
}

/** An n x n bitmap of the cells whose centre falls inside a circle
 * inscribed in the grid - the standard way to rasterize a circle as blocks
 * instead of drawing g.circle() and scaling a texture. */
export function circleBitmap(n: number): Bitmap {
  const r = n / 2;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const dx = x - r + 0.5;
      const dy = y - r + 0.5;
      row += dx * dx + dy * dy <= r * r ? "1" : "0";
    }
    rows.push(row);
  }
  return rows;
}

/** Same idea as circleBitmap but hollowed out into a ring. */
export function ringBitmap(n: number, innerRatio: number): Bitmap {
  const r = n / 2;
  const rInner = r * innerRatio;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const dx = x - r + 0.5;
      const dy = y - r + 0.5;
      const d2 = dx * dx + dy * dy;
      row += d2 <= r * r && d2 >= rInner * rInner ? "1" : "0";
    }
    rows.push(row);
  }
  return rows;
}

// Classic 5x7 dot-matrix digit font.
const DIGIT_GLYPHS: Bitmap[] = [
  ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], // 0
  ["00100", "01100", "00100", "00100", "00100", "00100", "01110"], // 1
  ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], // 2
  ["11111", "00010", "00100", "00010", "00001", "10001", "01110"], // 3
  ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], // 4
  ["11111", "10000", "11110", "00001", "00001", "10001", "01110"], // 5
  ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], // 6
  ["11111", "00001", "00010", "00100", "01000", "01000", "01000"], // 7
  ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], // 8
  ["01110", "10001", "10001", "01111", "00001", "00010", "01100"], // 9
];

const STAR_GLYPH: Bitmap = ["...1...", "..111..", ".11111.", "1111111", ".11111.", "..111..", "...1..."];

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

  // --- Ball: a chunky pixel-circle kaiju head - square eyes, blush, a
  // fang, two little back spikes. The outline is a second, slightly larger
  // circleBitmap pass drawn first so a ring of it peeks out from behind. ---
  place(
    "ball",
    (g) => {
      const px = 3.6;
      blit(g, circleBitmap(15), px, PALETTE.ink);
      blit(g, circleBitmap(13), px, PALETTE.green);

      g.rect(-9, -24, 5, 7).fill(PALETTE.mint);
      g.rect(4, -24, 5, 7).fill(PALETTE.mint);

      g.rect(-11, -7, 6, 6).fill(PALETTE.paper);
      g.rect(5, -7, 6, 6).fill(PALETTE.paper);
      g.rect(-9, -5, 3, 3).fill(PALETTE.ink);
      g.rect(7, -5, 3, 3).fill(PALETTE.ink);

      g.rect(-19, 2, 5, 4).fill({ color: PALETTE.pink, alpha: 0.8 });
      g.rect(14, 2, 5, 4).fill({ color: PALETTE.pink, alpha: 0.8 });

      g.rect(-4, 9, 8, 4).fill(PALETTE.ink);
      g.rect(-2, 9, 3, 5).fill(PALETTE.paper);
    },
    64,
  );

  // --- Flipper: a tapered stack of blocky segments (thick at the hinge,
  // narrow at the tip) instead of one smooth poly, drawn hinge-anchored in
  // its own reserved strip (see FLIPPER_* constants). ---
  {
    const g = new Graphics();
    const seg = (x: number, w: number, h: number, color: FillColor, pad = 0) => {
      g.rect(x - pad, -h / 2 - pad, w + pad * 2, h + pad * 2).fill(color);
    };
    // Outline pass (oversized, dark) then the body pass on top.
    seg(0, 20, 30, PALETTE.ink, 2);
    seg(18, 24, 24, PALETTE.ink, 2);
    seg(40, 22, 18, PALETTE.ink, 2);
    seg(60, 16, 12, PALETTE.ink, 2);

    seg(0, 20, 26, PALETTE.red);
    seg(18, 24, 20, PALETTE.red);
    seg(40, 22, 15, PALETTE.red);
    seg(60, 16, 9, PALETTE.red);

    g.rect(-9, -9, 18, 18).fill(PALETTE.ink);
    g.rect(-7, -7, 14, 14).fill(PALETTE.orange);
    g.rect(6, -9, 30, 4).fill({ color: PALETTE.paper, alpha: 0.5 });

    g.position.set(FLIPPER_HINGE_X, ROWS * CELL + FLIPPER_HINGE_Y);
    staging.addChild(g);
    frames.flipper = new Rectangle(0, ROWS * CELL, FLIPPER_W, FLIPPER_H);
  }

  // --- Buildings: one facade texture per distinct footprint size actually
  // used by the grid layout (physics/layout.ts). Drawn in white with
  // near-white windows so each building instance can be recoloured with a
  // per-Sprite tint (see entities/building.ts) while keeping the windows
  // reading as a lighter "glass" highlight under any tint.
  const buildingSizes = new Map<string, { w: number; h: number }>();
  for (const slot of BUILDING_SLOTS) {
    const r = buildingRect(slot);
    buildingSizes.set(buildingSizeKey(r.width, r.height), { w: r.width, h: r.height });
  }

  // Blocky pixel-art house facade, styled after a real reference game's
  // technique (muted material-colour walls, a tiled roof *band* rather
  // than a drawn triangle, and roof/door drawn as neutral grays so the
  // shared per-instance tint - see entities/building.ts - naturally
  // produces a *darker shade of that same wall colour* instead of a
  // separately-chosen bright hue, the same way a real building's trim
  // reads as "the wall colour, but shaded"). A `dizzy` variant just
  // flashes the window glass an accent colour for the hit reaction.
  // Every feature is a flat g.rect() block. Colliders/positions are
  // untouched - only the drawing changed.
  const drawBuildingFacade = (g: Graphics, w: number, h: number, dizzy: boolean) => {
    const wall = 0xffffff; // tinted per-instance, see entities/building.ts
    const roofGray = 0x707070; // ~44% multiply -> a shaded version of the wall tint
    const roofGrayLight = 0x8c8c8c;
    const roofGrayDark = 0x4a4a4a;
    const doorGray = 0x555555;
    const windowColor = dizzy ? PALETTE.pink : 0xdcf3ff;
    const porchLight = PALETTE.gold;

    // Tiled roof band along the top edge - a bright ridge cap, a few
    // vertical tile grooves, and a small chimney - instead of a drawn
    // triangle (which is easy to get backwards at this pixel scale).
    const roofW = w + 3;
    const roofH = h * 0.24;
    const roofTop = -h / 2;
    g.rect(-roofW / 2, roofTop, roofW, roofH).fill(roofGray);
    g.rect(-roofW / 2, roofTop, roofW, roofH * 0.3).fill(roofGrayLight);
    // Groove count scales with width so wider multi-cell roofs (see
    // physics/layout.ts's mixed 1x1/2x1/1x2/2x2 lot tiling) don't look
    // sparse.
    const grooves = Math.max(4, Math.round(roofW / 12));
    for (let i = 0; i < grooves; i++) {
      const gx = -roofW / 2 + (roofW / grooves) * (i + 0.5);
      g.rect(gx - 0.6, roofTop, 1.2, roofH).fill(roofGrayDark);
    }
    g.rect(w * 0.2, roofTop - 4, 3, 5).fill(roofGrayDark);

    // Walls below the roofline.
    const wallTop = roofTop + roofH;
    const wallH = h / 2 - wallTop;
    g.rect(-w / 2, wallTop, w, wallH).fill(wall);
    g.rect(-w / 2, wallTop, w, wallH).stroke({ width: 2, color: PALETTE.ink, alpha: 0.3 });

    // A grid of little windows - column/row counts scale with the wall's
    // own size so a wide 2x1 or tall 1x2 multi-cell lot (see
    // physics/layout.ts) reads as properly bigger, not just stretched.
    const winSize = Math.max(2.4, Math.min(w, h) * 0.13);
    const winCols = Math.max(2, Math.round(w / (winSize * 3.4)));
    const winRows = Math.max(1, Math.round(wallH / (winSize * 3.8)));
    const colStep = w / (winCols + 1);
    const rowStep = wallH / (winRows + 1);
    for (let ri = 1; ri <= winRows; ri++) {
      for (let ci = 1; ci <= winCols; ci++) {
        const wx = -w / 2 + colStep * ci;
        const wy = wallTop + rowStep * ri;
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).fill(windowColor);
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).stroke({ width: 1, color: PALETTE.ink, alpha: 0.5 });
      }
    }

    // A front door with a little porch light.
    const doorW = w * 0.24;
    const doorH = wallH * 0.55;
    g.rect(-doorW / 2, h / 2 - doorH, doorW, doorH).fill(doorGray);
    g.rect(-doorW * 0.55, h / 2 - doorH * 0.55, 1.6, 1.6).fill(porchLight);

    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: PALETTE.ink, alpha: 0.2 });
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

  // A generic, fixed-size house icon (same facade drawing, just re-run at
  // icon scale) for the building-type picker card UI - see
  // game/buildingSelect.ts.
  place("houseIcon", (g) => drawBuildingFacade(g, 44, 44, false), 48);

  // --- Retro pixel-art panicking pedestrian: every part (head, hair,
  // torso, arms, legs) is a flat g.rect() block. Two silhouettes
  // (legs swapped via `phase`) are alternated by the swarm for a
  // bouncy "running in a panic" cycle - hit radius and physics are
  // untouched, only the drawing changed. Drawn tiny and simple on
  // purpose - from kaiju/table scale a person should read as a scurrying
  // little bean, not a detailed character; the near-white body colour is
  // what entities/human.ts's per-instance tint recolours. ---
  const drawHuman = (g: Graphics, phase: number) => {
    const body = PALETTE.paper;
    const dark = PALETTE.ink;

    // tiny rounded bean-shaped body
    g.rect(-2.6, -4, 5.2, 7.5).fill(body);
    g.rect(-1.6, -5, 3.2, 1.5).fill(body);
    g.rect(-1.6, 3, 3.2, 1.5).fill(body);
    g.rect(-2.6, -4, 5.2, 7.5).stroke({ width: 1, color: dark, alpha: 0.5 });

    // two little legs, kicked out oppositely each frame
    g.rect(-2 - phase, 3.2, 1.5, 2.6).fill(dark);
    g.rect(0.5 + phase, 3.2, 1.5, 2.6).fill(dark);

    // tiny dot eyes
    g.rect(-1.3, -1.8, 1.2, 1.2).fill(dark);
    g.rect(0.1, -1.8, 1.2, 1.2).fill(dark);
  };
  place("human", (g) => drawHuman(g, -1), 32);
  place("humanRun", (g) => drawHuman(g, 1), 32);

  // --- Debris chunk (building destruction) - a small cluster of offset
  // blocks instead of a rounded poly. ---
  place(
    "debris",
    (g) => {
      g.rect(-7, -6, 7, 7).fill(0x8a7863);
      g.rect(-1, -3, 8, 8).fill(0xc9b8a3);
      g.rect(-6, 1, 6, 6).fill(0xa39070);
    },
    32,
  );

  // --- Spark (hit feedback) - a blocky 4-direction burst. ---
  place(
    "spark",
    (g) => {
      g.rect(-2, -2, 4, 4).fill(PALETTE.paper);
      g.rect(-9, -2, 5, 4).fill(PALETTE.gold);
      g.rect(4, -2, 5, 4).fill(PALETTE.gold);
      g.rect(-2, -9, 4, 5).fill(PALETTE.gold);
      g.rect(-2, 4, 4, 5).fill(PALETTE.gold);
    },
    32,
  );

  // --- Smoke puff - a soft blocky circle. ---
  place(
    "smoke",
    (g) => {
      blit(g, circleBitmap(9), 4, { color: 0xaaaab8, alpha: 0.55 });
    },
    48,
  );

  // --- Star (powerup icon) - a blocky diamond/gem, dark-outlined. ---
  place(
    "star",
    (g) => {
      blit(g, STAR_GLYPH, 6, PALETTE.ink, -21, -21);
      blit(g, STAR_GLYPH, 5, PALETTE.gold, -17.5, -17.5);
    },
    48,
  );

  // --- Ring (pop/kick fx) - a hollow pixel ring. ---
  place(
    "ring",
    (g) => {
      blit(g, ringBitmap(13, 0.55), 3.6, { color: PALETTE.paper, alpha: 0.9 });
    },
    48,
  );

  // --- Digits 0-9 for HP labels - a classic 5x7 dot-matrix font, instead
  // of rendered Text, with no backing plate so just the number itself
  // sits on the house. ---
  const digitNames: string[] = [];
  for (let d = 0; d <= 9; d++) {
    const name = `digit${d}`;
    digitNames.push(name);
    const { x, y } = nextCell();
    const g = new Graphics();
    blit(g, DIGIT_GLYPHS[d], 7, PALETTE.paper, -17.5, -24.5);
    g.position.set(x + CELL / 2, y + CELL / 2);
    staging.addChild(g);
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
    houseIcon: slice("houseIcon"),
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
