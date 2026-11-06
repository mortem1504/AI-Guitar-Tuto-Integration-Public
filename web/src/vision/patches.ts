/**
 * Following a small piece of picture from one frame to the next.
 *
 * This is the oldest trick in image registration and still the right one for
 * small motion: take a square of pixels around a point, then in the next frame
 * look for the square that matches it best, a few pixels either way.
 *
 * Two details do all the work of making it not drift and not lie:
 *
 *   - **Normalised cross-correlation**, not raw difference. A cloud passing the
 *     window, or a hand shading the neck, changes every pixel's brightness at
 *     once; NCC divides that out and compares *shape*, so the match survives
 *     the room's lighting changing under it.
 *   - **The template stays the original.** Matching each frame against the
 *     previous one accumulates a fraction of a pixel of error every time, and
 *     after a minute the grid has walked off the guitar. Matching always
 *     against the frame the student calibrated in cannot drift at all — it can
 *     only lose the point, which is a failure that announces itself.
 *
 * A third, added when a real guitar was tilted under it (BITACORA 2026-11-05):
 *
 *   - **The template is warped to the current view.** A square cut straight
 *     out of the calibration frame stops matching once the neck turns 15° or
 *     comes closer: the frets inside it are at the wrong angle and spacing.
 *     So the reference is resampled through the transform the tracker already
 *     believes — what that square *should* look like now — and then searched
 *     for. It is still the original frame's pixels, so it still cannot drift.
 *
 * Pure arithmetic over greyscale buffers: no canvas, no camera.
 */

import type { Matrix3 } from "./homography";
import type { Point } from "./landmarks";

/** A greyscale picture, row by row. */
export interface Grey {
  data: Float32Array;
  width: number;
  height: number;
}

/** Below this correlation the point is considered lost rather than moved. */
export const MIN_SCORE = 0.6;

/**
 * Below this mean squared deviation (grey levels²) a square is featureless:
 * bare wood correlates equally well with every other piece of bare wood, and
 * tracking it returns whichever position the noise favoured, with a high
 * score — the worst kind of answer. 12 is the value the first tracker used.
 */
const MIN_ENERGY = 12;

export interface Patch {
  size: number;
  /** The pixels, mean-removed, ready for correlation. */
  values: Float32Array;
  /** The square root of the sum of squares, precomputed for the denominator. */
  norm: number;
}

export interface Match {
  at: Point;
  score: number;
}

/** Bilinear sample; NaN off the picture. */
export function sample(grey: Grey, x: number, y: number): number {
  if (x < 0 || y < 0 || x > grey.width - 1 || y > grey.height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, grey.width - 1);
  const y1 = Math.min(y0 + 1, grey.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const row0 = y0 * grey.width;
  const row1 = y1 * grey.width;
  const top = grey.data[row0 + x0] * (1 - fx) + grey.data[row0 + x1] * fx;
  const bottom = grey.data[row1 + x0] * (1 - fx) + grey.data[row1 + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * The square of `size` pixels centred on `at` in the *current* picture, as
 * the reference picture predicts it: each of its pixels is sent through `map`
 * (current pixel -> reference pixel) and the reference is read there. Null
 * when any of it falls off the reference, or it has no contrast.
 */
export function warpedPatch(reference: Grey, map: Matrix3, at: Point, size: number): Patch | null {
  const half = (size - 1) / 2;
  const values = new Float32Array(size * size);
  let sum = 0;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const x = at.x - half + u;
      const y = at.y - half + v;
      const w = map[6] * x + map[7] * y + map[8];
      if (Math.abs(w) < 1e-9) return null;
      const value = sample(reference, (map[0] * x + map[1] * y + map[2]) / w, (map[3] * x + map[4] * y + map[5]) / w);
      if (Number.isNaN(value)) return null;
      values[v * size + u] = value;
      sum += value;
    }
  }
  const mean = sum / values.length;
  let energy = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    energy += values[i] * values[i];
  }
  if (energy < MIN_ENERGY * values.length) return null;
  return { size, values, norm: Math.sqrt(energy) };
}

/** Correlation scores of a patch at every whole-pixel offset within `radius` of `near` (-Infinity off the picture). */
export interface ScoreMap {
  scores: Float32Array;
  radius: number;
  centre: Point;
}

export function scoreMap(patch: Patch, grey: Grey, near: Point, radius: number): ScoreMap {
  const { size, values } = patch;
  const half = Math.floor(size / 2);
  const { width, height, data } = grey;
  const centre = { x: Math.round(near.x), y: Math.round(near.y) };
  const span = 2 * radius + 1;
  const scores = new Float32Array(span * span).fill(-Infinity);
  const count = size * size;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = centre.x + dx;
      const cy = centre.y + dy;
      if (cx - half < 0 || cy - half < 0 || cx + half >= width || cy + half >= height) continue;
      let sum = 0;
      let squares = 0;
      let dot = 0;
      for (let y = 0; y < size; y++) {
        const row = (cy - half + y) * width + (cx - half);
        const base = y * size;
        for (let x = 0; x < size; x++) {
          const value = data[row + x];
          sum += value;
          squares += value * value;
          dot += value * values[base + x];
        }
      }
      // The template is mean-removed, so the window's mean drops out of the dot product.
      const energy = squares - (sum * sum) / count;
      if (energy > 1e-6) scores[(dy + radius) * span + (dx + radius)] = dot / (patch.norm * Math.sqrt(energy));
    }
  }
  return { scores, radius, centre };
}

/**
 * The best place in a score map within `window` of offset (ox, oy), refined to
 * sub-pixel by a parabola through its neighbours — whole-pixel answers
 * quantise the homography into visible steps as the guitar moves. Null below
 * `minScore`, or on the rim of the window (the real place is probably further).
 */
export function peakIn(map: ScoreMap, ox: number, oy: number, window: number, minScore = MIN_SCORE): Match | null {
  const { scores, radius, centre } = map;
  const span = 2 * radius + 1;
  const at = (dx: number, dy: number) => (Math.abs(dx) > radius || Math.abs(dy) > radius ? -Infinity : scores[(dy + radius) * span + (dx + radius)]);
  let best = -Infinity;
  let bestX = 0;
  let bestY = 0;
  for (let dy = oy - window; dy <= oy + window; dy++) {
    for (let dx = ox - window; dx <= ox + window; dx++) {
      const score = at(dx, dy);
      if (score > best) {
        best = score;
        bestX = dx;
        bestY = dy;
      }
    }
  }
  if (!Number.isFinite(best) || best < minScore) return null;
  if (Math.abs(bestX - ox) === window || Math.abs(bestY - oy) === window) return null;
  const near = (dx: number, dy: number) => {
    const score = at(dx, dy);
    return Number.isFinite(score) ? score : best;
  };
  return {
    at: {
      x: centre.x + bestX + parabolic(near(bestX - 1, bestY), best, near(bestX + 1, bestY)),
      y: centre.y + bestY + parabolic(near(bestX, bestY - 1), best, near(bestX, bestY + 1)),
    },
    score: best,
  };
}

/** Finds a patch in `grey`, searching `radius` pixels either way around `near`, by normalised cross-correlation. */
export function matchPatch(patch: Patch, grey: Grey, near: Point, radius: number, minScore = MIN_SCORE): Match | null {
  return peakIn(scoreMap(patch, grey, near, radius), 0, 0, radius, minScore);
}

/**
 * The one shift that most of the maps agree on: their scores summed at every
 * offset. A fretboard square also correlates with the next fret along, but
 * that alias sits at a different offset for every fret (they crowd by
 * 2^(-n/12)), so aliases do not add up and the true shift does. `score` is
 * the mean correlation there of the points on the picture.
 */
export function commonShift(maps: readonly ScoreMap[], radius: number): { dx: number; dy: number; score: number } | null {
  const span = 2 * radius + 1;
  const total = new Float32Array(span * span);
  const count = new Uint16Array(span * span);
  for (const map of maps) {
    const own = 2 * map.radius + 1;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const score = map.scores[(dy + map.radius) * own + (dx + map.radius)];
        if (!Number.isFinite(score)) continue;
        total[(dy + radius) * span + (dx + radius)] += Math.max(0, score);
        count[(dy + radius) * span + (dx + radius)]++;
      }
    }
  }
  let best = -Infinity;
  let shift: { dx: number; dy: number; score: number } | null = null;
  // Points that would be off the picture at an offset do not vote there,
  // rather than voting 0: a guitar half out of frame is still that guitar.
  // But at least 40% of them must be on it, or a corner of the frame wins.
  const enough = Math.max(4, maps.length * 0.4);
  for (let i = 0; i < total.length; i++) {
    if (count[i] < enough) continue;
    const mean = total[i] / count[i];
    if (mean > best) {
      best = mean;
      shift = { dx: (i % span) - radius, dy: Math.floor(i / span) - radius, score: mean };
    }
  }
  return shift;
}

/** The offset of a parabola's peak, given three samples around it. */
function parabolic(before: number, here: number, after: number): number {
  const curvature = before - 2 * here + after;
  if (curvature === 0) return 0;
  const shift = (0.5 * (before - after)) / curvature;
  return Math.abs(shift) < 1 ? shift : 0;
}

/** Half the size each way, each pixel the mean of the four under it: the coarse level of the search. */
export function halve(grey: Grey): Grey {
  const width = Math.floor(grey.width / 2);
  const height = Math.floor(grey.height / 2);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const a = 2 * y * grey.width;
    const b = a + grey.width;
    for (let x = 0; x < width; x++) {
      const i = 2 * x;
      data[y * width + x] = (grey.data[a + i] + grey.data[a + i + 1] + grey.data[b + i] + grey.data[b + i + 1]) / 4;
    }
  }
  return { data, width, height };
}
