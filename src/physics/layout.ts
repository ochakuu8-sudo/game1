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
  radius: number;
}

// Six building bumper sites across the upper 2/3 of the table.
export const BUILDING_SLOTS: BuildingSlot[] = [
  { x: TABLE_W * 0.27, y: TABLE_H * 0.22, variant: "tower", radius: 40 },
  { x: TABLE_W * 0.73, y: TABLE_H * 0.22, variant: "tower", radius: 40 },
  { x: TABLE_W * 0.5, y: TABLE_H * 0.35, variant: "wide", radius: 38 },
  { x: TABLE_W * 0.22, y: TABLE_H * 0.48, variant: "wide", radius: 36 },
  { x: TABLE_W * 0.78, y: TABLE_H * 0.48, variant: "wide", radius: 36 },
  { x: TABLE_W * 0.5, y: TABLE_H * 0.6, variant: "tower", radius: 38 },
];

export const DRAIN_Y = TABLE_H + 40;
export const BALL_RADIUS = 13;
export const HUMAN_RADIUS = 10;
