/**
 * The four-point homography: the one piece of maths that turns a photograph of
 * a fretboard back into a fretboard.
 *
 * A flat rectangle photographed from an angle comes out as a quadrilateral, and
 * not just any quadrilateral — the parallel fret wires converge, and the ones
 * further away sit closer together. An affine transform cannot express that;
 * a projective one can, and it is fixed entirely by four point pairs.
 *
 * So: the student marks four corners, and from then on every fret of the
 * instrument has a known place in the picture, and every fingertip in the
 * picture has a known place on the instrument.
 *
 *   [u']   [h0 h1 h2] [x]                   u = u'/w'
 *   [v'] = [h3 h4 h5] [y]      with         v = v'/w'
 *   [w']   [h6 h7  1] [1]
 *
 * Pure arithmetic, no camera, no DOM — so it can be checked against pencil and
 * paper, which it was.
 */

import type { Point } from "./landmarks";

/** Row-major 3×3, nine numbers. */
export type Matrix3 = readonly number[];

/**
 * The transform taking each `from[i]` to the matching `to[i]`.
 *
 * Returns null when the four points do not describe a real quadrilateral —
 * three of them in a line, or two on top of each other. That happens for real:
 * a student double-clicks, or marks the neck end-on. Better an honest null than
 * a matrix full of infinities that quietly puts every target off screen.
 */
export function homographyFrom(from: readonly Point[], to: readonly Point[]): Matrix3 | null {
  if (from.length < 4 || to.length < 4) return null;

  // Eight unknowns, eight equations: two per point pair.
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const solved = solve(a, b);
  if (!solved) return null;
  return [...solved, 1];
}

/**
 * The same transform from *more* than four pairs, in the least-squares sense.
 *
 * Four points determine a homography exactly, which is what a calibration is.
 * Tracking is the other case: a dozen points are followed across the picture,
 * several are wrong or lost, and the answer wanted is the one that disagrees
 * least with all of them at once. With four you would have to choose which four
 * to believe; with twelve the arithmetic chooses.
 *
 * Solved through the normal equations. That is the numerically lazy way to do
 * least squares — the textbook answer is a QR or SVD decomposition — and it is
 * fine here: eight unknowns over well-spread image coordinates, nowhere near
 * ill-conditioned enough for the difference to show.
 */
export function homographyFromMany(from: readonly Point[], to: readonly Point[]): Matrix3 | null {
  const count = Math.min(from.length, to.length);
  if (count < 4) return null;
  if (count === 4) return homographyFrom(from, to);

  // Two rows per pair, eight unknowns.
  const rows: number[][] = [];
  const targets: number[] = [];
  for (let i = 0; i < count; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    targets.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    targets.push(v);
  }

  // Normal equations: (AᵀA) h = Aᵀb.
  const normal: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const right = new Array<number>(8).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < 8; i++) {
      right[i] += row[i] * targets[r];
      for (let j = 0; j < 8; j++) normal[i][j] += row[i] * row[j];
    }
  }

  const solved = solve(normal, right);
  if (!solved) return null;
  return [...solved, 1];
}

/** Gaussian elimination with partial pivoting. Null if the system is singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const lead = m[col][col];
    for (let k = col; k <= n; k++) m[col][k] /= lead;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }

  return m.map((row) => row[n]);
}

export function applyHomography(h: Matrix3, point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  // A point on the horizon divides by zero. Nudging keeps a wild calibration
  // drawing something absurd rather than crashing the animation frame.
  const safe = Math.abs(w) < 1e-12 ? 1e-12 : w;
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / safe,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / safe,
  };
}

export function invert(h: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-12) return null;

  const adj = [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
  return adj.map((value) => value / det);
}

/**
 * How badly a quadrilateral is degenerate, as the smallest triangle any three
 * of its corners make. Used to refuse a calibration before it is saved.
 */
export function quadArea(points: readonly Point[]): number {
  if (points.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}
