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

export const LEFT_FLIPPER: FlipperLayout = {
  pivot: { x: TABLE_W * 0.32, y: TABLE_H - 100 },
  restAngle: deg(35),
  activeAngle: deg(-35),
  length: 70,
  width: 20,
  side: "left",
};

export const RIGHT_FLIPPER: FlipperLayout = {
  pivot: { x: TABLE_W * 0.68, y: TABLE_H - 100 },
  restAngle: deg(145),
  activeAngle: deg(215),
  length: 70,
  width: 20,
  side: "right",
};

export interface BuildingSlot {
  x: number;
  y: number;
  variant: "wide" | "tower";
}

// Physical footprint of each building variant - must match the shapes baked
// in core/atlas.ts (buildingWide / buildingTower Graphics) so the collision
// box lines up with what's actually drawn on screen.
export const BUILDING_VARIANTS = {
  wide: { width: 84, height: 60, cornerRadius: 8 },
  tower: { width: 52, height: 92, cornerRadius: 8 },
} as const;

// Six building bumper sites across the upper 2/3 of the table.
export const BUILDING_SLOTS: BuildingSlot[] = [
  { x: TABLE_W * 0.27, y: TABLE_H * 0.22, variant: "tower" },
  { x: TABLE_W * 0.73, y: TABLE_H * 0.22, variant: "tower" },
  { x: TABLE_W * 0.5, y: TABLE_H * 0.35, variant: "wide" },
  { x: TABLE_W * 0.22, y: TABLE_H * 0.48, variant: "wide" },
  { x: TABLE_W * 0.78, y: TABLE_H * 0.48, variant: "wide" },
  { x: TABLE_W * 0.5, y: TABLE_H * 0.6, variant: "tower" },
];

export const DRAIN_Y = TABLE_H + 40;
export const BALL_RADIUS = 13;
export const HUMAN_RADIUS = 10;

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
export const OUTLANE_GUIDES: WallSeg[] = [
  { x1: -30, y1: 470, x2: LEFT_FLIPPER.pivot.x, y2: LEFT_FLIPPER.pivot.y, thickness: WALL_T },
  { x1: TABLE_W + 30, y1: 470, x2: RIGHT_FLIPPER.pivot.x, y2: RIGHT_FLIPPER.pivot.y, thickness: WALL_T },
];

// A small round static "cap" bridging the rail and the flipper's hinge.
// Rounded specifically so the ball is always redirected along a smooth
// curve at that junction instead of potentially catching in a corner.
export interface HingeGuard {
  x: number;
  y: number;
  radius: number;
}

export const FLIPPER_HINGE_GUARDS: HingeGuard[] = [
  { x: LEFT_FLIPPER.pivot.x - 15, y: LEFT_FLIPPER.pivot.y, radius: 25 },
  { x: RIGHT_FLIPPER.pivot.x + 15, y: RIGHT_FLIPPER.pivot.y, radius: 25 },
];
