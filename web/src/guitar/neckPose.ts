/**
 * Board -> picture transforms, as the neck tracker (`NeckFollower`) handles
 * them: measuring one, comparing two, turning one, fitting one over matched
 * points, and the views of the guitar it matches against.
 */

import { applyHomography, homographyFrom, homographyFromMany, type Matrix3 } from "../vision/homography";
import type { Point } from "../vision/landmarks";
import type { Grey } from "../vision/patches";
import { fretCentre, halfWidthAt, type BoardPoint, type GuitarSpec } from "./geometry";

/** Nut and 12th fret, both edges of an average neck: what the prediction and the checks move. */
export const REFERENCE_POINTS: BoardPoint[] = [
  { x: 0, y: -0.034 },
  { x: 0, y: 0.034 },
  { x: 0.5, y: 0.042 },
  { x: 0.5, y: -0.042 },
];

/** Points needed to trust a fit. Eight numbers want more than four points. */
export const MIN_TRACKED = 8;

/** How many four-point guesses to try. With half the points wrong, a random four are all right one time in 16; 120 tries miss that about once in 2,500. */
const CONSENSUS_TRIES = 120;

/**
 * One picture of the guitar to match against: a frame at full, half and
 * quarter size, where the board was in it, and the points worth looking for.
 * The first is the frame the student marked; the others are learned while
 * tracking goes well (`NeckFollower.learn`).
 */
export interface View {
  pyramid: Grey[];
  /** Board -> this view's pixels, at full working size. */
  toView: Matrix3;
  anchors: BoardPoint[];
  /** 0 for the marked view; otherwise one more than the view it was learned against. */
  depth: number;
  /** The running support while this view is matched and tracking is good (see `KEEP_SUPPORT`). */
  healthy: number;
  /** When it was last matched, so the least useful learned view is the one replaced. */
  used: number;
}

/** Length (nut to 12th), width and direction of the neck under `h`; null if it has folded over. */
export function measure(h: Matrix3): { length: number; width: number; angle: number } | null {
  const [a, b, c, d] = REFERENCE_POINTS.map((p) => applyHomography(h, p));
  // A neck seen from the front keeps its corners in order; a fold flips one turn.
  const turns = [a, b, c, d].map((p, i, all) => {
    const q = all[(i + 1) % 4];
    const r = all[(i + 2) % 4];
    return Math.sign((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x));
  });
  if (!turns.every((t) => t === turns[0]) || turns[0] === 0) return null;
  const nut = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const far = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
  return {
    length: Math.hypot(far.x - nut.x, far.y - nut.y),
    width: (Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(c.x - d.x, c.y - d.y)) / 2,
    angle: Math.atan2(far.y - nut.y, far.x - nut.x),
  };
}

/**
 * How differently two transforms show the neck, ignoring where in the
 * picture it is: the corners of nut-to-12th under each, both centred, the
 * furthest apart, as a share of the neck's length under `a`. Turning 0.1
 * rad gives about 0.05, growing by a fifth about 0.1. Sliding across the
 * picture gives 0: the guitar looks the same wherever it is.
 */
export function poseDistance(a: Matrix3, b: Matrix3): number {
  const shape = measure(a);
  if (!shape || shape.length === 0) return Infinity;
  const centred = (h: Matrix3) => {
    const corners = REFERENCE_POINTS.map((p) => applyHomography(h, p));
    const mid = { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
    return corners.map((p) => ({ x: p.x - mid.x, y: p.y - mid.y }));
  };
  const pa = centred(a);
  const pb = centred(b);
  return Math.max(...pa.map((p, i) => Math.hypot(p.x - pb[i].x, p.y - pb[i].y))) / shape.length;
}

/** `h`, then turned by `angle` and scaled by `size` about the middle of the neck it describes. */
export function turned(h: Matrix3, [angle, size]: readonly [number, number]): Matrix3 | null {
  if (angle === 0 && size === 1) return h;
  const corners = REFERENCE_POINTS.map((p) => applyHomography(h, p));
  const mid = { x: corners.reduce((a, p) => a + p.x, 0) / 4, y: corners.reduce((a, p) => a + p.y, 0) / 4 };
  const cos = Math.cos(angle) * size;
  const sin = Math.sin(angle) * size;
  const moved = corners.map((p) => ({ x: mid.x + (p.x - mid.x) * cos - (p.y - mid.y) * sin, y: mid.y + (p.x - mid.x) * sin + (p.y - mid.y) * cos }));
  return homographyFrom(REFERENCE_POINTS, moved);
}

/** a ∘ b: first b, then a. */
export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  }
  return out;
}

/**
 * Fits the transform over the points that agree with each other.
 *
 * Least squares first and outliers afterwards was tried and fails: three bad
 * anchors out of eighteen dragged the fit forty-five pixels off, and from
 * there the good points looked wrong too. So four anchors are picked at
 * random, the exact transform through them is scored by how many others it
 * explains, and only the winner's agreeing points are fitted.
 */
export function fitRobust(board: BoardPoint[], image: Point[], outlier: number): { h: Matrix3; inliers: number[] } | null {
  let best: number[] = [];
  for (let attempt = 0; attempt < CONSENSUS_TRIES; attempt++) {
    const sample = pickFour(board.length);
    if (!sample) break;
    const guess = homographyFrom(
      sample.map((i) => board[i]),
      sample.map((i) => image[i]),
    );
    if (!guess) continue;
    const agreeing: number[] = [];
    for (let i = 0; i < board.length; i++) {
      const p = applyHomography(guess, board[i]);
      if (Math.hypot(p.x - image[i].x, p.y - image[i].y) <= outlier) agreeing.push(i);
    }
    if (agreeing.length > best.length) best = agreeing;
  }
  if (best.length < MIN_TRACKED) return null;
  const h = homographyFromMany(
    best.map((i) => board[i]),
    best.map((i) => image[i]),
  );
  return h ? { h, inliers: best } : null;
}

/** Four distinct anchors, at random. */
function pickFour(count: number): number[] | null {
  if (count < 4) return null;
  const chosen = new Set<number>();
  for (let guard = 0; guard < 40 && chosen.size < 4; guard++) chosen.add(Math.floor(Math.random() * count));
  return chosen.size === 4 ? [...chosen] : null;
}

/**
 * Where the anchors go: three rows along the fretboard, kept off the edges
 * (half wood, half room, which stops matching when the background moves), and
 * a grid over the body around the soundhole or pickups. Past the 14th fret
 * (0.64 of the scale) every guitar is body, and ±0.14 of the scale (90 mm)
 * stays inside the narrowest body there; the bridge is at 1.
 */
export function layout(spec: GuitarSpec, farFret: number): BoardPoint[] {
  const points: BoardPoint[] = [];
  for (let fret = 1; fret <= Math.max(12, farFret); fret++) {
    const x = fretCentre(fret);
    const half = halfWidthAt(spec, x) * 0.7;
    for (const y of [-half, 0, half]) points.push({ x, y });
  }
  for (let x = 0.64; x <= 0.95; x += 0.062) {
    for (const y of [-0.14, -0.07, 0, 0.07, 0.14]) points.push({ x, y });
  }
  return points;
}
