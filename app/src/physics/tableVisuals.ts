import { Container, Graphics } from "pixi.js";
import { blit, circleBitmap } from "../core/atlas";
import { PALETTE } from "../core/palette";
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

  const fill = PALETTE.street;
  const edge = PALETTE.ink;
  const railFill = PALETTE.streetLine;

  const drawRect = (r: WallRect) => {
    const pts = rectCorners(r.x, r.y, r.w, r.h, r.angle ?? 0);
    g.poly(pts.flatMap((p) => [p.x, p.y])).fill(fill).stroke({ width: 3, color: edge });
  };

  const drawGuide = (raw: WallSeg) => {
    const s = clipToTable(raw);
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const cx = (s.x1 + s.x2) / 2;
    const cy = (s.y1 + s.y2) / 2;

    // Filled with a dark outline stroke, and capped at both ends with
    // blocky pixel-circles in the same fill colour - a straight-edged
    // rectangle meeting the round flipper-hinge guard at an angle would
    // otherwise leave a visibly sharp kink right at the joint. These caps
    // (plus the hinge guard below being large enough to fully absorb the
    // join, see layout.ts) blend the two into one shape instead. Purely a
    // visual approximation of the physics circles - the actual collider in
    // physics/world.ts is still an exact circle.
    const pts = rectCorners(cx, cy, length, s.thickness, angle);
    g.poly(pts.flatMap((p) => [p.x, p.y])).fill(railFill).stroke({ width: 2, color: edge });
    const capPx = s.thickness / 9;
    blit(g, circleBitmap(9), capPx, railFill, s.x1 - (9 * capPx) / 2, s.y1 - (9 * capPx) / 2);
    blit(g, circleBitmap(9), capPx, railFill, s.x2 - (9 * capPx) / 2, s.y2 - (9 * capPx) / 2);

    // A bright stripe down the middle of the rail so the slope reads
    // clearly against the dark playfield.
    const nx = (-dy / length) * (s.thickness / 2 - 3);
    const ny = (dx / length) * (s.thickness / 2 - 3);
    g.moveTo(s.x1 + nx, s.y1 + ny)
      .lineTo(s.x2 + nx, s.y2 + ny)
      .stroke({ width: 3, color: PALETTE.gold, alpha: 0.9 });
  };

  for (const w of OUTER_WALLS) drawRect(w);
  for (const s of OUTLANE_GUIDES) drawGuide(s);
  for (const h of FLIPPER_HINGE_GUARDS) {
    const px = (h.radius * 2) / 11;
    blit(g, circleBitmap(11), px, railFill, h.x - (11 * px) / 2, h.y - (11 * px) / 2);
  }

  c.addChild(g);
  return c;
}
