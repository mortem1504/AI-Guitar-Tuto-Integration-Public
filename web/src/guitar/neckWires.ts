/**
 * Finding the neck by its fret wires, when the remembered pictures of it no
 * longer match.
 *
 * `NeckFollower` matches squares of picture kept from earlier frames. On a
 * student's recording (BITACORA 2026-11-06) the guitar was moved — up the
 * picture, a fifth further away, turned 9° and seen more from above — and
 * after that no kept square matched it: at the true pose, checked against
 * the wires by hand, they scored 0.10-0.32 against 0.7 while tracking well,
 * and the near-misses the search found (a fret or two out) scored higher than
 * the truth. The grid never came back, and the student had to mark the neck
 * again.
 *
 * The fret wires, though, were as sharp as ever: brightness along the neck at
 * the true pose rises 20-35 grey levels on every wire, a tenth of a fret wide.
 * They do not change with the angle of view, the light on the varnish, or a
 * strumming arm over the body. So from a rough pose (within half a fret along
 * the neck), `lockToWires` finds each wire across three lanes and both edges
 * of the board, and fits the pose to them.
 *
 * Wires alone cannot say which fret is which: stretching the neck about the
 * bridge by 2^(k/12) lays every wire on another one. `neckInlays` tells
 * them apart.
 */

import { applyHomography, homographyFromMany, invert, type Matrix3 } from "../vision/homography";
import type { Point } from "../vision/landmarks";
import { sample, type Grey } from "../vision/patches";
import { fretLine, halfWidthAt, type BoardPoint, type GuitarSpec } from "./geometry";
import { fitRobust, multiply } from "./neckPose";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The wires looked for: past the 15th the frets are a few pixels apart and under the strumming arm. */
const LAST_WIRE = 15;
/** Lanes along the neck, as a share of its half-width: clear of the outer strings (0.85) and the edges. */
const LANES = [-0.55, 0, 0.55];
/** How far either side of where a wire is expected to look for it, in frets: half a fret, so the nearest wire wins. */
const WIRE_WINDOW = 0.45;
/**
 * A wire must stand this far above (or below) the board either side of it,
 * in grey levels. On the student's recording they stood 20-35 above the
 * rosewood; sensor noise is about 3.
 */
const WIRE_MIN = 10;
/** An edge of the board must be this sharp a step, in grey levels across 2 px. */
const EDGE_MIN = 12;
/**
 * Where to look for each edge, as a share of the half-width: wide of the
 * outer strings at 0.85, and far enough out to catch an edge the start put
 * half a board's width off (the lanes then pull it across).
 */
const EDGE_FROM = 0.92;
const EDGE_TO = 1.6;
/** Pixels between samples along a profile: a third, so a one-pixel wire is seen in full. */
const STEP_PX = 0.33;
/** A fit must agree with this many wire points over this many frets, and see both edges, to be the neck. */
const MIN_WIRE_POINTS = 12;
const MIN_WIRE_SPAN = 5;
const MIN_EDGE_POINTS = 3;
/** Pixels off its fit before a wire or edge point is an outlier: a third of the narrowest fret box looked at. */
const OUTLIER_PX = 1.5;
/**
 * Refits until the pose moves less than this (pixels, at the finger spots),
 * and at most this many times; one that has not settled by then is not
 * trusted. Three fixed rounds were tried first: from a rough start on
 * synthetic video the third was still moving, and drew a grid 4.4 px off.
 * On the student's recording a settled lock still moves 0.4-0.6 px a round
 * at the spots under the hand, where nothing is seen and the fit reaches.
 */
const SETTLED_PX = 0.75;
const MAX_ROUNDS = 6;
/**
 * A round on which fewer than this share of the wires found agree is a
 * start too far out: the fit lurches between half-matched wire sets (40-120
 * px a round, on the recording) rather than closing in. Give up at once and
 * let the next start try.
 */
const MIN_AGREE_SHARE = 0.5;

/**
 * The search for a lost neck (`startsNear`): bands across within this many
 * pixels of where it was (a sixth of the picture's width), the best two, and
 * starts along each this far either way, this far apart — within a lock's
 * reach of half a fret (5-6 px at the 9th on the recording) everywhere.
 */
const BAND_REACH_PX = 56;
const BANDS = 2;
const ALONG_REACH_PX = 48;
const ALONG_STEP_PX = 6;


/** The neck locked onto its wires: the pose, and how many wire and edge points agreed. */
export interface Locked {
  h: Matrix3;
  wires: number;
  edges: number;
}

/** Why the last `lockToWires` gave up, "" if it did not: for `?debug` and for measuring. */
export let lockMiss = "";

/** From `seed` (board -> pixels, within half a fret along the neck), the pose the wires and edges agree on, or null. */
export function lockToWires(grey: Grey, seed: Matrix3, spec: GuitarSpec, hands: readonly Box[]): Locked | null {
  let h = seed;
  // Each fit moves the lanes onto the neck a little better, until it stops moving.
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const board: BoardPoint[] = [];
    const image: Point[] = [];
    let wirePoints = 0;
    for (let fret = 1; fret <= LAST_WIRE; fret++) {
      for (const lane of LANES) {
        const found = findWire(grey, h, spec, fret, lane, hands);
        if (!found) continue;
        board.push({ x: fretLine(fret), y: lane * halfWidthAt(spec, fretLine(fret)) });
        image.push(found);
        wirePoints++;
      }
    }
    lockMiss = `round ${round + 1}: ${wirePoints} wire points`;
    if (wirePoints < MIN_WIRE_POINTS) return null;
    // An edge point says where the edge is, not how far along the neck: it
    // was looked for where the guess put that fret, which may be half a fret
    // out. So the wires, which do say how far along, place it: where the fit
    // to the wires alone puts that pixel.
    const alongWires = polished(fitRobust(board, image, OUTLIER_PX)?.h ?? null, board, image);
    const back = alongWires ? invert(alongWires.h) : null;
    if (!alongWires || !back || alongWires.inliers.length < MIN_AGREE_SHARE * wirePoints) return null;
    for (let space = 1; space <= LAST_WIRE; space++) {
      for (const side of [1, -1]) {
        const found = findEdge(grey, h, spec, fretLine(space - 0.5), side, hands);
        if (!found) continue;
        const x = applyHomography(back, found).x;
        if (!(x > 0 && x < 1)) continue;
        board.push({ x, y: side * halfWidthAt(spec, x) });
        image.push(found);
      }
    }
    lockMiss += `, ${board.length - wirePoints} edge points`;
    const fit = polished(fitRobust(board, image, OUTLIER_PX)?.h ?? null, board, image);
    const agreed = fit ? fit.inliers.map((i) => board[i]) : [];
    const wires = agreed.filter((p) => Math.abs(p.y) < halfWidthAt(spec, p.x) * 0.9);
    const frets = new Set(wires.map((p) => Math.round(-12 * Math.log2(1 - p.x))));
    const edges = agreed.length - wires.length;
    const sides = new Set(agreed.filter((p) => Math.abs(p.y) >= halfWidthAt(spec, p.x) * 0.9).map((p) => Math.sign(p.y)));
    lockMiss += `; agreed ${wires.length} wire points over ${frets.size} frets, ${edges} edge points on ${sides.size} sides`;
    const whole = fit && wires.length >= MIN_WIRE_POINTS && frets.size >= MIN_WIRE_SPAN && edges >= MIN_EDGE_POINTS && sides.size === 2;
    // Until both edges agree, the wires alone move the lanes on: from a start
    // off across the neck, one edge comes into reach a round later.
    const next = whole ? fit.h : alongWires.h;
    const moved = movement(h, next, spec);
    lockMiss += `, moved ${moved.toFixed(1)}`;
    h = next;
    if (whole && moved < SETTLED_PX) {
      lockMiss = "";
      return { h, wires: wires.length, edges };
    }
  }
  lockMiss += `; not settled in ${MAX_ROUNDS} rounds`;
  return null;
}

/**
 * The consensus fit is drawn from random samples, so two fits over the same
 * points differ a little at the edges of what agreed — enough that a lock
 * never "settled". Refitting over every point within the outlier distance of
 * the last fit, twice, lands on the same answer whichever sample won.
 */
function polished(h: Matrix3 | null, board: BoardPoint[], image: Point[]): { h: Matrix3; inliers: number[] } | null {
  let inliers: number[] = [];
  for (let pass = 0; pass < 3 && h; pass++) {
    const fit = h;
    inliers = board.map((_, i) => i).filter((i) => {
      const p = applyHomography(fit, board[i]);
      return Math.hypot(p.x - image[i].x, p.y - image[i].y) <= OUTLIER_PX;
    });
    if (inliers.length < MIN_WIRE_POINTS || pass === 2) break;
    h = homographyFromMany(
      inliers.map((i) => board[i]),
      inliers.map((i) => image[i]),
    );
  }
  return h && inliers.length >= MIN_WIRE_POINTS ? { h, inliers } : null;
}

/** How far apart two poses put the middle of each fret box, frets 1-12 (pixels, the worst). */
export function movement(a: Matrix3, b: Matrix3, spec: GuitarSpec): number {
  let worst = 0;
  for (let fret = 1; fret <= 12; fret++) {
    const x = fretLine(fret - 0.5);
    for (const side of [1, -1]) {
      const p = { x, y: side * halfWidthAt(spec, x) * 0.85 };
      const q = applyHomography(a, p);
      const r = applyHomography(b, p);
      worst = Math.max(worst, Math.hypot(q.x - r.x, q.y - r.y));
    }
  }
  return worst;
}

/**
 * Where to start locking when the neck has been lost: along the band where
 * the board's two edges are sharpest, near `around`, nearest first.
 *
 * A start must be within half a fret of the wires. On the student's
 * recording the neck came to rest 21 px along and 6 across from where it was
 * last seen; a sweep over shifts scored by edges and wires together put its
 * best starts 20-60 px out, because a board slides along itself and looks the
 * same. Across the neck the edges did agree, every best start within 4 px of
 * the truth. So the edges choose the band, and starts go every
 * `ALONG_STEP_PX` along it: the wires settle the rest, and the pattern says
 * which fret.
 */
export function startsNear(grey: Grey, around: Matrix3, spec: GuitarSpec, hands: readonly Box[]): Matrix3[] {
  const a = applyHomography(around, { x: fretLine(4), y: 0 });
  const b = applyHomography(around, { x: fretLine(11), y: 0 });
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return [];
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const across = { x: -along.y, y: along.x };
  const moved = (h: Matrix3, d: Point) => multiply([1, 0, d.x, 0, 1, d.y, 0, 0, 1], h);
  const bands: { offset: number; score: number }[] = [];
  for (let offset = -BAND_REACH_PX; offset <= BAND_REACH_PX; offset += 2) {
    bands.push({ offset, score: edgeScore(grey, moved(around, { x: across.x * offset, y: across.y * offset }), spec, hands) });
  }
  bands.sort((p, q) => q.score - p.score);
  const kept: number[] = [];
  for (const band of bands) {
    if (!Number.isFinite(band.score) || kept.length === BANDS) break;
    if (kept.every((k) => Math.abs(k - band.offset) >= 6)) kept.push(band.offset);
  }
  const starts: Matrix3[] = [];
  for (let step = 0; step * ALONG_STEP_PX <= ALONG_REACH_PX; step++) {
    for (const sign of step === 0 ? [1] : [1, -1]) {
      for (const offset of kept) {
        const shift = sign * step * ALONG_STEP_PX;
        starts.push(moved(around, { x: across.x * offset + along.x * shift, y: across.y * offset + along.y * shift }));
      }
    }
  }
  return starts;
}

/** How sharply the board's edges stand out where `h` puts them: the mean step across each, frets 2-13. */
function edgeScore(grey: Grey, h: Matrix3, spec: GuitarSpec, hands: readonly Box[]): number {
  let total = 0;
  let count = 0;
  for (let fret = 2; fret <= 13; fret++) {
    const x = fretLine(fret - 0.5);
    const half = halfWidthAt(spec, x);
    for (const side of [1, -1]) {
      const inside = applyHomography(h, { x, y: side * half * 0.85 });
      const outside = applyHomography(h, { x, y: side * half * 1.15 });
      if (under(hands, inside) || under(hands, outside)) continue;
      const a = sample(grey, inside.x, inside.y);
      const b = sample(grey, outside.x, outside.y);
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      total += Math.abs(b - a);
      count++;
    }
  }
  return count >= 8 ? total / count : -Infinity;
}


/** Where along the lane the wire `fret` is, near where `h` puts it: the brightest (or darkest) thin line. */
function findWire(grey: Grey, h: Matrix3, spec: GuitarSpec, fret: number, lane: number, hands: readonly Box[]): Point | null {
  const point = (u: number) => {
    const x = fretLine(u);
    return applyHomography(h, { x, y: lane * halfWidthAt(spec, x) });
  };
  // Read a little past the window, so a wire near its end still has board
  // either side of it to stand out from (at the 12th the window is ±3 px).
  const reach = WIRE_WINDOW + 0.3;
  const from = point(fret - reach);
  const to = point(fret + reach);
  if (under(hands, from) || under(hands, to)) return null;
  const count = Math.min(160, Math.max(12, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STEP_PX)));
  const values: number[] = [];
  const at: Point[] = [];
  const us: number[] = [];
  for (let i = 0; i <= count; i++) {
    const u = fret - reach + (2 * reach * i) / count;
    const p = point(u);
    const v = sample(grey, p.x, p.y);
    if (Number.isNaN(v)) return null;
    values.push(v);
    at.push(p);
    us.push(u);
  }
  // A line a pixel or two wide: its middle against the board 1.5 px either side.
  const d = Math.max(2, Math.round(1.5 / STEP_PX));
  let best = 0;
  let bestAt = -1;
  for (let i = d; i < values.length - d; i++) {
    if (Math.abs(us[i] - fret) > WIRE_WINDOW) continue;
    const ridge = values[i] - (values[i - d] + values[i + d]) / 2;
    if (Math.abs(ridge) > Math.abs(best)) {
      best = ridge;
      bestAt = i;
    }
  }
  if (Math.abs(best) < WIRE_MIN) return null;
  return at[bestAt];
}

/** Where the board's edge on `side` crosses the line across the neck at `x`: the sharpest step there. */
function findEdge(grey: Grey, h: Matrix3, spec: GuitarSpec, x: number, side: number, hands: readonly Box[]): Point | null {
  const half = halfWidthAt(spec, x);
  const from = applyHomography(h, { x, y: side * half * EDGE_FROM });
  const to = applyHomography(h, { x, y: side * half * EDGE_TO });
  if (under(hands, from) || under(hands, to)) return null;
  const count = Math.min(80, Math.max(8, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STEP_PX)));
  const m = Math.max(2, Math.round(2 / STEP_PX));
  const values: number[] = [];
  const at: Point[] = [];
  for (let i = -m; i <= count + m; i++) {
    const p = applyHomography(h, { x, y: side * half * (EDGE_FROM + ((EDGE_TO - EDGE_FROM) * i) / count) });
    const v = sample(grey, p.x, p.y);
    if (Number.isNaN(v)) return null;
    values.push(v);
    at.push(p);
  }
  let best = 0;
  let bestAt = -1;
  for (let i = m; i < values.length - m; i++) {
    let inside = 0;
    let outside = 0;
    for (let j = 1; j <= m; j++) {
      inside += values[i - j];
      outside += values[i + j];
    }
    const step = (outside - inside) / m;
    if (Math.abs(step) > Math.abs(best)) {
      best = step;
      bestAt = i;
    }
  }
  if (Math.abs(best) < EDGE_MIN || bestAt <= m || bestAt >= values.length - m - 1) return null;
  return at[bestAt];
}

export function under(boxes: readonly Box[], point: Point): boolean {
  return boxes.some((box) => point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1);
}
