/**
 * A dot that falls outside the picture.
 *
 * With the nut off camera (a laptop framed on the player, BITACORA
 * 2026-11-05) the first frets are off the picture too, and so is every dot a
 * chord puts there: Em's two fingers on fret 2 simply were not drawn, and the
 * lesson looked like it had nothing to show. Such a dot is drawn at the edge
 * instead, with a pointer towards where it really is.
 *
 * Where on the edge matters. Kept at its own height, a dot on a neck that
 * rises out of the picture was drawn in the air above it, on the wall. So a
 * dot can name a point on the picture it lies in line with — its string,
 * further up the neck — and is then drawn where that line leaves the picture:
 * on its own string, at the edge. A string is a straight line in the picture
 * (the board is a plane), so that is exact.
 */

import type { Point } from "../vision/landmarks";

export interface EdgeMark {
  /** Where to draw it, in canvas pixels: `inset` inside the edge nearest the real spot. */
  at: Point;
  /** Which way the real spot is from there, in radians (canvas axes). */
  angle: number;
}

/**
 * Null when `p` (canvas pixels) is on the canvas, or is not a point at all.
 * `from`, when it is well inside the canvas, is a point `p` lies in line with:
 * the mark goes where the line from it to `p` meets the inset edge. Without
 * one, the nearest point of the inset edge.
 */
export function edgeMark(p: Point, width: number, height: number, inset: number, from?: Point): EdgeMark | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || width <= 0 || height <= 0) return null;
  if (p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) return null;
  const low = (size: number) => Math.min(inset, size / 2);
  const high = (size: number) => Math.max(size - inset, size / 2);
  if (from && from.x >= low(width) && from.x <= high(width) && from.y >= low(height) && from.y <= high(height)) {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    // How far along from `from` to `p` the inset edge is met, each way.
    let t = 1;
    if (dx > 0) t = Math.min(t, (high(width) - from.x) / dx);
    if (dx < 0) t = Math.min(t, (low(width) - from.x) / dx);
    if (dy > 0) t = Math.min(t, (high(height) - from.y) / dy);
    if (dy < 0) t = Math.min(t, (low(height) - from.y) / dy);
    return { at: { x: from.x + dx * t, y: from.y + dy * t }, angle: Math.atan2(dy, dx) };
  }
  const clamp = (v: number, size: number) => Math.min(Math.max(v, low(size)), high(size));
  const at = { x: clamp(p.x, width), y: clamp(p.y, height) };
  return { at, angle: Math.atan2(p.y - at.y, p.x - at.x) };
}
