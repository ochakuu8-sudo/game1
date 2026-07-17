import { Container, Graphics } from "pixi.js";
import { OUTER_WALLS, OUTLANE_GUIDES, FLIPPER_HINGE_GUARDS, TABLE_H, type WallRect, type WallSeg } from "./layout";

function rectCorners(cx: number, cy: number, w: number, h: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const local = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return local.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

/** Clips a wall segment's far endpoint to the visible table so guide rails
 * that intentionally overshoot the table (for solid physics coverage) don't
 * draw way past the bottom edge. */
function clipToTable(s: WallSeg): WallSeg {
  if (s.y2 <= TABLE_H && s.y1 <= TABLE_H) return s;
  const t = (TABLE_H - s.y1) / (s.y2 - s.y1);
  return { ...s, x2: s.x1 + (s.x2 - s.x1) * t, y2: TABLE_H };
}

/**
 * Draws the same wall/outlane geometry the physics world is built from
 * (physics/world.ts), so what the player sees always matches what the ball
 * actually collides with.
 */
export function buildTableVisuals(): Container {
  const c = new Container();
  const g = new Graphics();

  const fill = 0x2f3a52;
  const edge = 0x596b8f;

  const drawRect = (r: WallRect) => {
    const pts = rectCorners(r.x, r.y, r.w, r.h, r.angle ?? 0);
    g.poly(pts.flatMap((p) => [p.x, p.y])).fill(fill).stroke({ width: 2, color: edge, alpha: 0.8 });
  };

  const drawGuide = (raw: WallSeg) => {
    const s = clipToTable(raw);
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const cx = (s.x1 + s.x2) / 2;
    const cy = (s.y1 + s.y2) / 2;
    const pts = rectCorners(cx, cy, length, s.thickness, angle);
    g.poly(pts.flatMap((p) => [p.x, p.y])).fill(0x3a4766).stroke({ width: 2, color: 0x7a8fc2, alpha: 0.9 });

    // A bright stripe down the middle of the rail so the slope reads
    // clearly against the dark playfield, chevron-style toward the flipper.
    const nx = (-dy / length) * (s.thickness / 2 - 3);
    const ny = (dx / length) * (s.thickness / 2 - 3);
    g.moveTo(s.x1 + nx, s.y1 + ny)
      .lineTo(s.x2 + nx, s.y2 + ny)
      .stroke({ width: 3, color: 0xffcf5c, alpha: 0.85 });
  };

  for (const w of OUTER_WALLS) drawRect(w);
  for (const s of OUTLANE_GUIDES) drawGuide(s);
  for (const h of FLIPPER_HINGE_GUARDS) {
    g.circle(h.x, h.y, h.radius).fill(0x3a4766).stroke({ width: 2, color: 0x7a8fc2, alpha: 0.9 });
  }

  c.addChild(g);
  return c;
}
