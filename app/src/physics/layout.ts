// Design-space table dimensions. Everything (physics + rendering) is
// authored in this coordinate space; main.ts scales+letterboxes it to fit
// whatever the device screen actually is.
export const TABLE_W = 420;
export const TABLE_H = 760;
export const WALL_T = 16;

export const deg = (d: number) => (d * Math.PI) / 180;

export interface FlipperLayout {
  pivot: { x: number; y: number };
  restAngle: number;
  activeAngle: number;
  length: number;
  width: number;
  side: "left" | "right";
}

// Rest angle shallower than before (35 -> 20 deg) so the flipper droops
// less steeply and sits closer to the outlane rail's own (also flattened,
// see OUTLANE_GUIDES) slope; active angle shifted by the same amount so
// the total swing stays 70 deg.
export const LEFT_FLIPPER: FlipperLayout = {
  pivot: { x: TABLE_W * 0.32, y: TABLE_H - 100 },
  restAngle: deg(20),
  activeAngle: deg(-50),
  length: 70,
  width: 20,
  side: "left",
};

export const RIGHT_FLIPPER: FlipperLayout = {
  pivot: { x: TABLE_W * 0.68, y: TABLE_H - 100 },
  restAngle: deg(160),
  activeAngle: deg(230),
  length: 70,
  width: 20,
  side: "right",
};

// City block grid the buildings are placed on, occupying whole numbers of
// cells (1x1, 1x2, 2x1, 2x2, ...) like real street blocks, instead of being
// scattered at arbitrary coordinates. Sits between the top wall and the
// outlane rails (which start at y=470, see OUTLANE_GUIDES below).
export const GRID_COLS = 12;
export const GRID_ROWS = 13;
export const GRID_LEFT = 40;
export const GRID_TOP = 72;
export const GRID_RIGHT = TABLE_W - 40;
export const GRID_BOTTOM = 440;
export const GRID_CELL_W = (GRID_RIGHT - GRID_LEFT) / GRID_COLS;
export const GRID_CELL_H = (GRID_BOTTOM - GRID_TOP) / GRID_ROWS;
// Gap left between a building's actual (collidable/drawn) footprint and its
// cell(s)' edges - 0 so the grid packs edge to edge with no street gaps.
const GRID_INSET = 0;

export interface BuildingSlot {
  col: number;
  row: number;
  spanCols: number;
  spanRows: number;
}

export interface BuildingRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
}

export function buildingRect(slot: BuildingSlot): BuildingRect {
  const cellX = GRID_LEFT + slot.col * GRID_CELL_W;
  const cellY = GRID_TOP + slot.row * GRID_CELL_H;
  const cellW = slot.spanCols * GRID_CELL_W;
  const cellH = slot.spanRows * GRID_CELL_H;
  return {
    x: cellX + cellW / 2,
    y: cellY + cellH / 2,
    width: cellW - GRID_INSET * 2,
    height: cellH - GRID_INSET * 2,
    cornerRadius: 8,
  };
}

export const DRAIN_Y = TABLE_H + 40;
export const BALL_RADIUS = 13;
export const HUMAN_RADIUS = 6;

// --- Static table boundary geometry, shared by the physics world builder
// (physics/world.ts) and the visual renderer (physics/tableVisuals.ts) so
// the walls the ball bounces off are always exactly what the player sees.

export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

export interface WallSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

export const OUTER_WALLS: WallRect[] = [
  { x: WALL_T / 2, y: TABLE_H / 2, w: WALL_T, h: TABLE_H }, // left
  { x: TABLE_W - WALL_T / 2, y: TABLE_H / 2, w: WALL_T, h: TABLE_H }, // right
  { x: TABLE_W / 2, y: WALL_T / 2, w: TABLE_W, h: WALL_T }, // top
  { x: WALL_T + 26, y: WALL_T + 10, w: 70, h: WALL_T, angle: -0.6 }, // top-left bevel
  { x: TABLE_W - WALL_T - 26, y: WALL_T + 10, w: 70, h: WALL_T, angle: 0.6 }, // top-right bevel
];

// Outlane guides: single straight rails from just inside the main side
// walls down to the flipper's own pivot, so there is no gap the ball can
// slip through between the wall and the flipper. Each is one continuous
// body (not multiple joined segments) so there's no seam to leak through,
// and it starts well outside the table (x < 0 / x > TABLE_W) so it fully
// overlaps the main side wall instead of merely touching it.
//
// The far end lands ON the pivot. An earlier version stopped just short of
// the flipper's hinge circle (a few px "clearance" gap, deliberately too
// narrow for the ball) to avoid ever touching the flipper body - but a
// straight rail meeting a circle at an angle, even without overlapping,
// forms a concave notch right at the junction, and the ball would wedge
// into it and sit there permanently. Rails/circles now overlap generously
// (see FLIPPER_HINGE_GUARD below) so there's no concave pocket at all -
// this is safe now that Flipper.step() recomputes the flipper's position
// fresh every step rather than basing it on the body's own (possibly
// solver-perturbed) position, so persistent contact with a static body
// can no longer drag its pivot off target.
// y1 at 530 (between the original 470 and the too-flat 565) puts each
// rail's own slope at roughly 38deg from horizontal - a bit more incline
// than 30deg while staying well short of the original 49deg. The plain
// side wall covers the stretch above where the rail now starts.
export const OUTLANE_GUIDES: WallSeg[] = [
  { x1: -30, y1: 530, x2: LEFT_FLIPPER.pivot.x, y2: LEFT_FLIPPER.pivot.y, thickness: WALL_T },
  { x1: TABLE_W + 30, y1: 530, x2: RIGHT_FLIPPER.pivot.x, y2: RIGHT_FLIPPER.pivot.y, thickness: WALL_T },
];

// A small round static "cap" bridging the rail and the flipper's hinge.
// Rounded specifically so the ball is always redirected along a smooth
// curve at that junction instead of potentially catching in a corner.
export interface HingeGuard {
  x: number;
  y: number;
  radius: number;
}

// Smaller than before (radius 25 -> 17, offset 15 -> 10) for a less
// bulgy seam - still just enough to keep the pivot itself inside the
// circle (offset < radius), which is what actually prevents the concave
// notch a smaller-but-not-overlapping guard would reopen.
export const FLIPPER_HINGE_GUARDS: HingeGuard[] = [
  { x: LEFT_FLIPPER.pivot.x - 10, y: LEFT_FLIPPER.pivot.y, radius: 17 },
  { x: RIGHT_FLIPPER.pivot.x + 10, y: RIGHT_FLIPPER.pivot.y, radius: 17 },
];
