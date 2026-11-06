/**
 * Checks the fret-progression test with no camera and no photograph.
 *
 *   npm run fret-check
 *
 * The detector's whole problem is telling a fretboard from anything else in a
 * bedroom that has stripes on it, and the answer it now leans on is that frets
 * crowd towards the bridge by 2^(-n/12) while blankets, blinds and radiators
 * are evenly spaced. That claim is checkable without hardware: feed it the
 * positions a real neck produces, and the positions a striped thing produces,
 * and see which ones it accepts.
 */

import { fitFretProgression } from "../src/vision/NeckDetector.ts";
import { markingProblem, orderCorners } from "../src/guitar/corners.ts";
import { Fretboard } from "../src/guitar/Fretboard.ts";
import { GUITARS, fretLine, halfWidthAt } from "../src/guitar/geometry.ts";
import { applyHomography, homographyFrom } from "../src/vision/homography.ts";

const fretAt = (n) => 1 - Math.pow(2, -n / 12);

/** Frets 1..count of a neck whose scale length is `scale` working pixels. */
function neck(count, scale = 300, nut = 40, noise = 0) {
  const out = [];
  for (let fret = 1; fret <= count; fret++) {
    out.push(nut + scale * fretAt(fret) + (Math.random() - 0.5) * 2 * noise);
  }
  return out;
}

/** Evenly spaced stripes: a blanket, a radiator, the slats of a blind. */
function stripes(count, gap = 14, from = 55) {
  return Array.from({ length: count }, (_, i) => from + i * gap);
}

let failures = 0;

function check(label, positions, nut, expect) {
  const fit = fitFretProgression(positions, nut);
  const got = fit ? `frets ${fit.frets.join(",")} score ${fit.score.toFixed(2)}` : "rejected";
  const ok = expect === "accept" ? Boolean(fit) : !fit;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(40)} ${got}`);
  return fit;
}

// What a guitar gives it.
check("frets 1-8, exact", neck(8), 40, "accept");
check("frets 1-8, 1px of noise", neck(8, 300, 40, 1), 40, "accept");
check("frets 1-4 only (light near the nut)", neck(4), 40, "accept");
const strays = check("frets 1-8 plus 3 stray lines", [...neck(8), 120, 175, 260], 40, "accept");
if (strays) {
  // Accepting it is not enough. What matters is the *scale*, because that is
  // what places every fret on the grid; a stray line that happens to sit on a
  // fret of the right scale is indistinguishable from a fret and harmless,
  // while a scale bought by strays reads eight frets as nineteen.
  const off = Math.abs(strays.scale - 300) / 300;
  const ok = off < 0.03;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${"strays did not stretch the scale".padEnd(40)} scale ${strays.scale.toFixed(1)} of 300`);
}
check("frets 1-12, short scale (150px)", neck(12, 150, 20), 20, "accept");
// The nut is found from where the strings stop, so it arrives a little off.
check("frets 1-8, nut estimated 4px late", neck(8), 44, "accept");

// What a room gives it.
check("6 even stripes, 14px apart", stripes(6), 55, "reject");
check("6 even stripes, 30px apart", stripes(6, 30), 55, "reject");
check("6 even stripes, 8px apart", stripes(6, 8), 55, "reject");
check("10 even stripes (a blind)", stripes(10), 55, "reject");
check("4 even stripes, wide", stripes(4, 45), 55, "reject");
check("3 random lines", [80, 132, 291], 40, "reject");

// The one that has to be right, not merely accepted: the number of frets the
// grid will be drawn over comes out of this fit.
const real = check("frets 1-9, does it read the count", neck(9), 40, "accept");
if (real) {
  const last = real.frets[real.frets.length - 1];
  const ok = last === 9;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${"furthest fret read as 9".padEnd(40)} got ${last}`);
}

// The finding that shaped the detector: fret positions are invariant to a
// shift of fret number, so wires alone cannot say which fret is which. Kept as
// a check so nobody writes the nut-free fit again.
const shifted = (() => {
  const k = 3;
  const a = neck(7, 300, 40);
  // Renumbering the frets n+k and multiplying the scale by 2^(k/12) — with the
  // nut moved to keep the constant term — reproduces the same positions.
  const scale = 300 * Math.pow(2, k / 12);
  const nut = 40 + 300 - scale;
  const b = Array.from({ length: 7 }, (_, i) => nut + scale * fretAt(i + 1 + k));
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
})();
{
  const ok = shifted < 1e-9;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${"frets 1-7 == frets 4-10, rescaled".padEnd(40)} worst difference ${shifted.toExponential(1)}`);
}

// A hand marking that cannot be nut-to-12th must be turned down, not saved.
// The first quad is the real one from a student's recording (2026-11-05, screen
// pixels in an 800x392 picture): four clicks around one fret box, nut off the
// edge. The others are what a right marking looks like on the same picture.
{
  const W = 800;
  const H = 392;
  const marked = (points) => orderCorners(points.map(([x, y]) => ({ x: x / W, y: y / H })));
  const cases = [
    ["one fret box (recording) refused", [[523, 263], [497, 269], [512, 334], [540, 329]], "tooClose"],
    ["nut to 12th, square on, accepted", [[780, 190], [780, 232], [330, 300], [330, 248]], null],
    ["nut to 12th, turned 60deg, accepted", [[555, 214], [555, 256], [330, 300], [330, 248]], null],
    ["nut to 5th, square on, accepted", [[780, 190], [780, 232], [620, 250], [620, 205]], null],
    ["two clicks per end at one fret refused", [[500, 250], [500, 300], [530, 300], [530, 250]], "tooClose"],
  ];
  for (const [name, points, want] of cases) {
    const got = markingProblem(marked(points), W / H);
    const ok = got === want;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(40)} got ${got}`);
  }
}

// With the nut off the picture the near pair goes on a fret wire, and the
// least ratio shrinks with the span marked: a turned 3rd-to-12th marking is
// refused as if it were nut-to-12th, and accepted as what it is.
{
  const W = 800;
  const H = 392;
  const quad = orderCorners([[600, 200], [600, 245], [490, 255], [490, 205]].map(([x, y]) => ({ x: x / W, y: y / H })));
  for (const [name, span, want] of [
    ["3rd to 12th, turned, as nut-to-12th", 0.5, "tooClose"],
    ["3rd to 12th, turned, as 3rd-to-12th", fretLine(12) - fretLine(3), null],
  ]) {
    const got = markingProblem(quad, W / H, span);
    const ok = got === want;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(40)} got ${got}`);
  }
}

// Marked on the 3rd fret, the board must be the one marking the nut gives:
// same grid on every wire, its corners where the (unclickable) nut is.
{
  const spec = GUITARS.acoustic;
  const truth = homographyFrom(
    [{ x: 0, y: 0.04 }, { x: 0, y: -0.04 }, { x: 0.5, y: -0.04 }, { x: 0.5, y: 0.04 }],
    [{ x: 1.15, y: 0.3 }, { x: 1.17, y: 0.45 }, { x: 0.4, y: 0.62 }, { x: 0.37, y: 0.4 }],
  );
  const edge = (fret, side) => applyHomography(truth, { x: fretLine(fret), y: side * halfWidthAt(spec, fretLine(fret)) });
  const board = Fretboard.from(spec, [edge(3, 1), edge(3, -1), edge(12, -1), edge(12, 1)], 12, "edges", 3);
  let worst = Infinity;
  if (board) {
    const misses = [0, 1, 5, 7, 9, 12].flatMap((fret) => [1, -1].map((side) => {
      const want = edge(fret, side);
      const got = board.toCamera({ x: fretLine(fret), y: side * halfWidthAt(spec, fretLine(fret)) });
      return Math.hypot(got.x - want.x, got.y - want.y);
    }));
    const nut = [edge(0, 1), edge(0, -1)];
    misses.push(...nut.map((want, i) => Math.hypot(board.corners[i].x - want.x, board.corners[i].y - want.y)));
    worst = Math.max(...misses);
  }
  const ok = worst < 1e-6;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${"marked on fret 3 == marked on the nut".padEnd(40)} worst difference ${worst.toExponential(1)}`);
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
