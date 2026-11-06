/**
 * Which fret is which, once the neck is locked onto its wires (`neckWires`):
 * stretching the neck about the bridge by 2^(k/12) lays every wire on
 * another one, so the wires alone cannot say. What tells them apart is this
 * guitar's own pattern along the neck — the dots at 3, 5, 7, 9, the pair or
 * the blocks at 12, the end of the neck at the body — recorded when the neck
 * was marked (`barcode`) and matched at every shift (`fretShift`). A guitar
 * with nothing to tell its frets apart answers nothing, and stays lost.
 */

import { applyHomography, type Matrix3 } from "../vision/homography";
import { sample, type Grey } from "../vision/patches";
import { fretLine, halfWidthAt, type GuitarSpec } from "./geometry";
import { multiply } from "./neckPose";
import { under, type Box } from "./neckWires";

/** Fret spaces in the barcode (space n lies between wires n-1 and n). */
const SPACES = 15;
/**
 * The first space read: no guitar has an inlay before the 3rd fret, and the
 * first two are where the fretting hand mostly is — its skin, missed by the
 * hand boxes, read 4-19 spreads bright at marking, and its shadow 4-5 dark
 * later (the student's recording, 36 s and 55.9 s), and outvoted the 12th.
 */
const FIRST_SPACE = 3;
/** The barcode's shifts tried: as far as a recovery can be a stretch out (`ALIASES` in NeckFollower). */
const SHIFTS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
/**
 * Only marks that stand out count: a space this many spreads (robust, per
 * lane) brighter or darker than the spaces round it — an inlay, not
 * the grain. The student's 12th-fret blocks stood 7-8 spreads out at 55.9 s;
 * the grain between them, and the light on it, under 3. A whole-pattern correlation
 * was tried first and is not safe: on a synthetic board with no inlays, whose
 * grain looked different after leaning in, chance alone matched a shift four
 * frets out, and the search asks many times a second.
 */
const MARK_SPREADS = 4;
/**
 * A mark seen now meets one in the marked view that stood this many spreads
 * out the same way: there it may have been fainter. The student's 12th-fret
 * bars stood 2.7-3.7 spreads out at marking, because a glare beside them lit
 * the board round them; at 55.9 s, 7-8. Faint marks in the marked view only
 * ever confirm a strong one seen now: alone they decide nothing.
 */
const FAINT_SPREADS = 2.5;
/**
 * The lanes the barcode reads (shares of the half-width): the middle, where
 * single dots are; between the 2nd and 3rd strings each side, where a 12th
 * fret's pair of dots usually are; and further out, where the student's
 * guitar has its 12th-fret blocks (read there, not at 0.45 or nearer).
 */
const INLAY_LANES = [-0.55, -0.34, 0, 0.34, 0.55];
/**
 * Each space is read as a share brighter or darker than the median of itself
 * and the seen spaces nearest it, this many each way: a shadow across the
 * neck darkens an inlay as much as the board round it, and a median that
 * counts the space itself keeps a shadow's edge where it is (a lane's
 * straight-line trend did not, and read the edge as an inlay: the student's
 * own shadow moving onto the neck, synthetic, BITACORA 2026-11-06). The whole
 * width of the space is no reference: the student's 12th-fret blocks span
 * it, and cancelled. Two each way was too few: the dots at 3, 5, 7 and 9 are
 * every other space, and three of five were dots.
 */
const NEAR_SPACES = 3;
/** A spread below this (a share of the board's brightness) is sensor noise, not a quiet board: 3 grey levels on a dark board's 60. */
const MIN_SPREAD = 0.05;
/**
 * The shift chosen is where the marks line up best (`overlap`), at least
 * this well, and no other shift may come within half of it. There, at least
 * `MIN_MEETINGS` marks seen now must meet one, and at most half as many may
 * contradict one (bright where the marked view saw dark, or the other way).
 * A mark where the marked view saw plain board contradicts nothing: a hand's
 * shadow or a glare makes one, and so did the edge of the student's shadow,
 * read as twelve "marks" at the true pose (synthetic). One stray bright space
 * meeting by chance is not a guitar's inlays (on random synthetic boards, one
 * meeting claimed a shift 2-5 times in 1000). Marks the marked view had and
 * the picture now lacks count against nothing either: a finger or a glare
 * hides an inlay, it does not move it.
 */
const MIN_FIT = 0.5;
const MIN_MEETINGS = 2;

/**
 * This guitar's pattern along the neck: the mean brightness of the middle of
 * each fret space, in each lane (NaN where it is off the picture or under a
 * hand). Kept when the neck is marked; the inlays make it this guitar's own.
 */
export function barcode(grey: Grey, h: Matrix3, spec: GuitarSpec, hands: readonly Box[]): Float32Array {
  const code = new Float32Array(INLAY_LANES.length * SPACES).fill(Number.NaN);
  for (let space = FIRST_SPACE; space <= SPACES; space++) {
    INLAY_LANES.forEach((lane, l) => {
      let total = 0;
      for (const u of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        const x = fretLine(space - 1 + u);
        for (const dy of [-0.12, 0, 0.12]) {
          const at = applyHomography(h, { x, y: (lane + dy) * halfWidthAt(spec, x) });
          const value = under(hands, at) ? Number.NaN : sample(grey, at.x, at.y);
          if (Number.isNaN(value)) return;
          total += value;
        }
      }
      code[l * SPACES + space - 1] = total / 15;
    });
  }
  return againstNear(code);
}

/** Each space as a share brighter (+) or darker (-) than the median of itself and the `2 * NEAR_SPACES` seen spaces nearest it, in its lane. */
function againstNear(code: Float32Array): Float32Array {
  const out = new Float32Array(code.length).fill(Number.NaN);
  for (let l = 0; l < INLAY_LANES.length; l++) {
    for (let n = 0; n < SPACES; n++) {
      const v = code[l * SPACES + n];
      if (Number.isNaN(v)) continue;
      // Itself and its nearest seen neighbours, reaching past spaces a hand hides.
      const near = [v];
      for (let d = 1; d <= 2 * NEAR_SPACES && near.length <= 2 * NEAR_SPACES; d++) {
        for (const m of [n - d, n + d]) {
          const w = m >= 0 && m < SPACES ? code[l * SPACES + m] : Number.NaN;
          if (!Number.isNaN(w)) near.push(w);
        }
      }
      const level = near.length > NEAR_SPACES + 1 ? median(near) : 0;
      if (level > 0) out[l * SPACES + n] = v / level - 1;
    }
  }
  return out;
}

/**
 * How many frets `now` (a barcode read through a pose that may be a stretch
 * out) is shifted from `marked`: k when the space read as n is really n + k.
 * Null when the marks (inlays) do not clearly line up at exactly one shift,
 * or there are none: a board with nothing on it cannot tell its frets apart.
 */
export let shiftMiss = "";
export function fretShift(now: Float32Array, marked: Float32Array): number | null {
  const a = spreads(now);
  const b = spreads(marked);
  const tally = SHIFTS.map((k) => {
    let meet = 0;
    let clash = 0;
    for (let l = 0; l < INLAY_LANES.length; l++) {
      for (let n = 0; n < SPACES; n++) {
        const m = n + k;
        if (m < 0 || m >= SPACES) continue;
        const x = a[l * SPACES + n];
        const y = b[l * SPACES + m];
        if (Number.isNaN(x) || Number.isNaN(y) || Math.abs(x) < MARK_SPREADS) continue;
        if (Math.sign(x) === Math.sign(y) && Math.abs(y) >= FAINT_SPREADS) meet++;
        else if (Math.sign(x) !== Math.sign(y) && Math.abs(y) >= FAINT_SPREADS) clash++;
      }
    }
    return { meet, clash, fit: overlap(a, b, k) };
  });
  const best = tally.reduce((p, q, i) => (q.fit > tally[p].fit ? i : p), 0);
  const { meet, clash, fit } = tally[best];
  const runnerUp = Math.max(...tally.filter((_, i) => i !== best).map((t) => t.fit));
  shiftMiss = `${SHIFTS[best]}: fit ${fit.toFixed(2)} (next ${runnerUp.toFixed(2)}), ${meet} met, ${clash} not`;
  if (fit < MIN_FIT || runnerUp > fit / 2 || meet < MIN_MEETINGS || clash > meet / 2) return null;
  return SHIFTS[best];
}

/** How well two lanes' marks line up at shift k, every mark weighed by how far it stands out (0-1, normalised). */
function overlap(a: Float32Array, b: Float32Array, k: number): number {
  const weight = (z: number) => Math.sign(z) * Math.min(6, Math.max(0, Math.abs(z) - 2));
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let l = 0; l < INLAY_LANES.length; l++) {
    for (let n = 0; n < SPACES; n++) {
      const m = n + k;
      if (m < 0 || m >= SPACES) continue;
      const x = a[l * SPACES + n];
      const y = b[l * SPACES + m];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      dot += weight(x) * weight(y);
      na += weight(x) ** 2;
      nb += weight(y) ** 2;
    }
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Each lane in robust spreads: how far each space stands out from the rest of its lane. */
function spreads(code: Float32Array): Float32Array {
  const out = code.slice();
  for (let l = 0; l < INLAY_LANES.length; l++) {
    const lane = out.subarray(l * SPACES, (l + 1) * SPACES);
    const seen = Array.from(lane).filter((v) => !Number.isNaN(v));
    if (seen.length < 4) {
      lane.fill(Number.NaN);
      continue;
    }
    const middle = median(seen);
    const spread = Math.max(MIN_SPREAD, 1.4826 * median(seen.map((v) => Math.abs(v - middle))));
    for (let n = 0; n < SPACES; n++) {
      if (Number.isNaN(lane[n])) continue;
      lane[n] = (lane[n] - middle) / spread;
    }
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The pose that reads space n + k where `h` reads n: `h`, stretched about the bridge by 2^(k/12). */
export function shifted(h: Matrix3, k: number): Matrix3 {
  const s = Math.pow(2, k / 12);
  return multiply(h, [s, 0, 1 - s, 0, s, 0, 0, 0, 1]);
}
