import { Container, Graphics, Rectangle, RenderTexture, Texture, type Renderer } from "pixi.js";
import { buildingRect, LEFT_FLIPPER } from "../physics/layout";
import { buildFlipperShape } from "../physics/flipper";
import { BUILDING_TYPES } from "../entities/buildingTypes";
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
export interface Atlas {
  ball: Texture;
  flipper: Texture;
  /** Keyed by BuildingType.id (see entities/buildingTypes.ts) - each type
   * has its own facade artwork/size baked once at its fixed footprint. */
  buildings: Record<string, Texture>;
  /** Same keys as `buildings` - a "dizzy" variant (windows flash an accent
   * colour) flashed briefly on a hit. */
  buildingsDizzy: Record<string, Texture>;
  /** Same keys as `buildings` - a small fixed-size icon of each type's own
   * facade, for the building-type picker card UI. */
  buildingIcons: Record<string, Texture>;
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

  // --- Flipper: a real flipper's asymmetric wedge - a flat top edge the
  // full length, and a bottom edge tapering from full width at the hinge
  // down to a narrow tip - drawn from buildFlipperShape() in
  // physics/flipper.ts, the exact same function call that builds the
  // physics collider, rather than a hand-tuned approximation of it that
  // could quietly drift out of sync with the real hitbox. Same smooth-
  // polygon-plus-stroke technique physics/tableVisuals.ts already uses for
  // the other physics-matched shapes (walls/rails), not the blocky
  // Famicom-style rects used for the game's non-physics sprites. ---
  {
    const g = new Graphics();
    const halfLen = LEFT_FLIPPER.length / 2;
    const halfW = LEFT_FLIPPER.width / 2;

    const outline = buildFlipperShape(LEFT_FLIPPER.length, LEFT_FLIPPER.width);
    const pts = outline.vertices.flatMap((v) => [v.x + halfLen, v.y]);
    g.poly(pts).fill(PALETTE.red).stroke({ width: 3, color: PALETTE.ink });

    g.rect(-5, -5, 10, 10).fill(PALETTE.ink);
    g.rect(-3.5, -3.5, 7, 7).fill(PALETTE.orange);
    g.rect(6, -halfW + 2, 30, 3).fill({ color: PALETTE.paper, alpha: 0.5 });

    g.position.set(FLIPPER_HINGE_X, ROWS * CELL + FLIPPER_HINGE_Y);
    staging.addChild(g);
    frames.flipper = new Rectangle(0, ROWS * CELL, FLIPPER_W, FLIPPER_H);
  }

  // --- Buildings: every BuildingType (entities/buildingTypes.ts) gets its
  // own facade drawing at its own fixed footprint/colour, instead of one
  // shared shape recoloured per instance - a bungalow looks like a
  // bungalow, a tower looks like a tower. All still flat g.rect() blocks;
  // `shade()` derives roof/trim/door tones from each type's own base
  // colour so the whole facade reads as one material, not a random accent.
  const shade = (color: number, factor: number): number => {
    const r = Math.round(((color >> 16) & 0xff) * factor);
    const gr = Math.round(((color >> 8) & 0xff) * factor);
    const b = Math.round((color & 0xff) * factor);
    return (r << 16) | (gr << 8) | b;
  };

  type FacadeDrawer = (g: Graphics, w: number, h: number, dizzy: boolean, color: number) => void;

  // 平屋 - low single-storey bungalow: shallow roof, one wide window.
  const drawFlat: FacadeDrawer = (g, w, h, dizzy, color) => {
    const roofC = shade(color, 0.45);
    const roofLight = shade(color, 0.62);
    const doorC = shade(color, 0.3);
    const winC = dizzy ? PALETTE.pink : 0xdcf3ff;

    const roofH = h * 0.16;
    const roofTop = -h / 2;
    const roofW = w + 4;
    g.rect(-roofW / 2, roofTop, roofW, roofH).fill(roofC);
    g.rect(-roofW / 2, roofTop, roofW, roofH * 0.35).fill(roofLight);

    const wallTop = roofTop + roofH;
    const wallH = h / 2 - wallTop;
    g.rect(-w / 2, wallTop, w, wallH).fill(color);
    g.rect(-w / 2, wallTop, w, wallH).stroke({ width: 2, color: PALETTE.ink, alpha: 0.3 });

    const winW = w * 0.4;
    const winH = wallH * 0.32;
    const winY = wallTop + wallH * 0.3;
    g.rect(-winW / 2, winY - winH / 2, winW, winH).fill(winC);
    g.rect(-winW / 2, winY - winH / 2, winW, winH).stroke({ width: 1, color: PALETTE.ink, alpha: 0.5 });

    const doorW = w * 0.26;
    const doorH = wallH * 0.55;
    g.rect(-doorW / 2, h / 2 - doorH, doorW, doorH).fill(doorC);

    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: PALETTE.ink, alpha: 0.25 });
  };

  // 一軒家 - classic two-storey house with a proper pointed gable roof
  // (narrow at the peak, full width at the eaves) and a little chimney.
  const drawStandard: FacadeDrawer = (g, w, h, dizzy, color) => {
    const roofC = shade(color, 0.4);
    const doorC = shade(color, 0.28);
    const winC = dizzy ? PALETTE.pink : 0xdcf3ff;

    const roofH = h * 0.3;
    const roofTop = -h / 2;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const stepW = (w * (i + 1)) / steps; // narrow at i=0 (peak) -> full width at i=steps-1 (eaves)
      const stepH = roofH / steps;
      g.rect(-stepW / 2, roofTop + i * stepH, stepW, stepH + 0.6).fill(roofC);
    }
    g.rect(w * 0.22, roofTop - 4, 3, 5).fill(shade(color, 0.3));

    const wallTop = roofTop + roofH;
    const wallH = h / 2 - wallTop;
    g.rect(-w / 2, wallTop, w, wallH).fill(color);
    g.rect(-w / 2, wallTop, w, wallH).stroke({ width: 2, color: PALETTE.ink, alpha: 0.3 });

    const winSize = Math.min(w, h) * 0.13;
    for (const wy of [wallTop + wallH * 0.28, wallTop + wallH * 0.6]) {
      for (const wx of [-w * 0.24, w * 0.24]) {
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).fill(winC);
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).stroke({ width: 1, color: PALETTE.ink, alpha: 0.5 });
      }
    }

    const doorW = w * 0.22;
    const doorH = wallH * 0.32;
    g.rect(-doorW / 2, h / 2 - doorH, doorW, doorH).fill(doorC);

    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: PALETTE.ink, alpha: 0.25 });
  };

  // アパート - flat-roofed block with many small windows in a dense grid.
  const drawApartment: FacadeDrawer = (g, w, h, dizzy, color) => {
    const roofC = shade(color, 0.4);
    const doorC = shade(color, 0.25);
    const winC = dizzy ? PALETTE.pink : 0xbfe0f5;

    const roofH = h * 0.05;
    const roofTop = -h / 2;
    g.rect(-w / 2 - 2, roofTop, w + 4, roofH).fill(roofC);

    const wallTop = roofTop + roofH;
    const wallH = h / 2 - wallTop;
    g.rect(-w / 2, wallTop, w, wallH).fill(color);
    g.rect(-w / 2, wallTop, w, wallH).stroke({ width: 2, color: PALETTE.ink, alpha: 0.3 });

    const winSize = Math.max(2.2, Math.min(w, h) * 0.09);
    const winCols = Math.max(2, Math.round(w / (winSize * 2.6)));
    const winRows = Math.max(3, Math.round(wallH / (winSize * 2.6)));
    const colStep = w / (winCols + 1);
    const rowStep = wallH / (winRows + 1);
    for (let ri = 1; ri <= winRows; ri++) {
      for (let ci = 1; ci <= winCols; ci++) {
        const wx = -w / 2 + colStep * ci;
        const wy = wallTop + rowStep * ri;
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).fill(winC);
      }
    }

    const doorW = w * 0.3;
    const doorH = wallH * 0.1;
    g.rect(-doorW / 2, h / 2 - doorH, doorW, doorH).fill(doorC);

    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: PALETTE.ink, alpha: 0.25 });
  };

  // 豪邸 - grand estate: wide gable roof, two chimneys, symmetric window
  // columns, a double door, and a low hedge/fence line along the base.
  const drawMansion: FacadeDrawer = (g, w, h, dizzy, color) => {
    const roofC = shade(color, 0.35);
    const roofTrim = shade(color, 0.55);
    const doorC = shade(color, 0.25);
    const winC = dizzy ? PALETTE.pink : 0xdcf3ff;

    const roofH = h * 0.26;
    const roofTop = -h / 2;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const stepW = (w * (i + 1)) / steps;
      const stepH = roofH / steps;
      g.rect(-stepW / 2, roofTop + i * stepH, stepW, stepH + 0.6).fill(i === steps - 1 ? roofTrim : roofC);
    }
    g.rect(-w * 0.3 - 2, roofTop - 5, 4, 6).fill(shade(color, 0.3));
    g.rect(w * 0.3 - 2, roofTop - 5, 4, 6).fill(shade(color, 0.3));

    const wallTop = roofTop + roofH;
    const wallH = h / 2 - wallTop;
    g.rect(-w / 2, wallTop, w, wallH).fill(color);
    g.rect(-w / 2, wallTop, w, wallH).stroke({ width: 2, color: PALETTE.ink, alpha: 0.3 });

    const winSize = Math.min(w, h) * 0.075;
    for (const wy of [wallTop + wallH * 0.22, wallTop + wallH * 0.48]) {
      for (const wx of [-w * 0.34, -w * 0.12, w * 0.12, w * 0.34]) {
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).fill(winC);
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).stroke({ width: 1, color: PALETTE.ink, alpha: 0.4 });
      }
    }

    const doorW = w * 0.14;
    const doorH = wallH * 0.3;
    g.rect(-doorW - 1, h / 2 - doorH, doorW, doorH).fill(doorC);
    g.rect(1, h / 2 - doorH, doorW, doorH).fill(doorC);
    g.rect(-w / 2 - 2, h / 2 - 2, w + 4, 3).fill(shade(color, 0.5));

    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: PALETTE.ink, alpha: 0.25 });
  };

  // タワマン - modern high-rise: near-flat roof, a rooftop tank/antenna,
  // and a dense glass curtain-wall window grid.
  const drawTower: FacadeDrawer = (g, w, h, dizzy, color) => {
    const roofC = shade(color, 0.4);
    const frameC = shade(color, 0.3);
    const winC = dizzy ? PALETTE.pink : 0xbfe8f5;

    const roofH = h * 0.025;
    const roofTop = -h / 2;
    g.rect(-w / 2 - 2, roofTop, w + 4, roofH).fill(roofC);
    g.rect(-w * 0.2 - 3, roofTop - 6, 6, 6).fill(shade(color, 0.35));
    g.rect(w * 0.15, roofTop - 10, 1.5, 10).fill(PALETTE.ink);

    const wallTop = roofTop + roofH;
    const wallH = h / 2 - wallTop;
    g.rect(-w / 2, wallTop, w, wallH).fill(color);
    g.rect(-w / 2, wallTop, w, wallH).stroke({ width: 2, color: PALETTE.ink, alpha: 0.3 });

    const winSize = Math.max(2, Math.min(w, h) * 0.07);
    const winCols = Math.max(3, Math.round(w / (winSize * 2.4)));
    const winRows = Math.max(5, Math.round(wallH / (winSize * 2.2)));
    const colStep = w / (winCols + 1);
    const rowStep = wallH / (winRows + 1);
    for (let ri = 1; ri <= winRows; ri++) {
      for (let ci = 1; ci <= winCols; ci++) {
        const wx = -w / 2 + colStep * ci;
        const wy = wallTop + rowStep * ri;
        g.rect(wx - winSize / 2, wy - winSize / 2, winSize, winSize).fill(winC);
      }
    }

    const doorW = w * 0.28;
    const doorH = wallH * 0.03;
    g.rect(-doorW / 2, h / 2 - doorH - 2, doorW, doorH).fill(frameC);

    g.rect(-w / 2, -h / 2, w, h).stroke({ width: 2, color: PALETTE.ink, alpha: 0.25 });
  };

  const FACADE_DRAWERS: Record<string, FacadeDrawer> = {
    flat: drawFlat,
    standard: drawStandard,
    apartment: drawApartment,
    mansion: drawMansion,
    tower: drawTower,
  };

  // Packed into their own strip (like the flipper) since some spans (e.g.
  // 2x3) are far larger than one CELL and would bleed into neighbours.
  // Normal and dizzy variants sit side by side per type, plus a small
  // fixed-size icon for the picker card.
  const buildingStripY = ROWS * CELL + FLIPPER_H;
  let buildingStripX = 0;
  let buildingStripH = 0;
  const buildingFrames: Record<string, Rectangle> = {};
  const dizzyFrames: Record<string, Rectangle> = {};
  const iconFrames: Record<string, Rectangle> = {};
  for (const type of BUILDING_TYPES) {
    const rect = buildingRect({ col: 0, row: 0, spanCols: type.spanCols, spanRows: type.spanRows });
    const { width: w, height: h } = rect;
    const draw = FACADE_DRAWERS[type.id] ?? drawStandard;

    const g = new Graphics();
    draw(g, w, h, false, type.color);
    g.position.set(buildingStripX + w / 2, buildingStripY + h / 2);
    staging.addChild(g);
    buildingFrames[type.id] = new Rectangle(buildingStripX, buildingStripY, w, h);
    buildingStripX += w + 8;

    const gd = new Graphics();
    draw(gd, w, h, true, type.color);
    gd.position.set(buildingStripX + w / 2, buildingStripY + h / 2);
    staging.addChild(gd);
    dizzyFrames[type.id] = new Rectangle(buildingStripX, buildingStripY, w, h);
    buildingStripX += w + 8;

    buildingStripH = Math.max(buildingStripH, h);

    const gi = new Graphics();
    draw(gi, 44, 44, false, type.color);
    gi.position.set(buildingStripX + 22, buildingStripY + 22);
    staging.addChild(gi);
    iconFrames[type.id] = new Rectangle(buildingStripX, buildingStripY, 44, 44);
    buildingStripX += 44 + 8;

    buildingStripH = Math.max(buildingStripH, 44);
  }

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
  const buildingIcons: Record<string, Texture> = {};
  for (const [key, frame] of Object.entries(iconFrames)) {
    buildingIcons[key] = sliceRect(frame);
  }

  return {
    ball: slice("ball"),
    flipper: slice("flipper"),
    buildings,
    buildingsDizzy,
    buildingIcons,
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
