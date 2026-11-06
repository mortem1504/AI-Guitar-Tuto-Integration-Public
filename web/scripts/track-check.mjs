/**
 * Checks the tracking maths without a camera.
 *
 *   npm run track-check
 *
 * A synthetic neck is warped by a known homography — the guitar shifting,
 * turning and tilting away — and the least-squares fit is asked to recover it
 * from the moved points, including some that are deliberately wrong the way a
 * hand across the strings makes them wrong.
 */

import { homographyFromMany, applyHomography, homographyFrom } from "../src/vision/homography.ts";

// A plausible camera view of a neck: shifted, rotated a little, and with the
// far end smaller than the near one.
const truth = homographyFrom(
  [
    { x: 0, y: -0.03 },
    { x: 0, y: 0.03 },
    { x: 0.5, y: 0.04 },
    { x: 0.5, y: -0.04 },
  ],
  [
    { x: 0.80, y: 0.42 },
    { x: 0.80, y: 0.52 },
    { x: 0.30, y: 0.60 },
    { x: 0.28, y: 0.36 },
  ],
);

// A dozen anchors spread over the fretboard, as the tracker lays them out.
const board = [];
for (let fret = 1; fret <= 6; fret++) {
  const x = (fret - 0.4) / 12;
  for (const y of [-0.02, 0, 0.02]) board.push({ x, y });
}

const clean = board.map((p) => applyHomography(truth, p));

function report(label, fitted, corrupted) {
  if (!fitted) {
    console.log(`${label.padEnd(34)} FAILED to fit`);
    return;
  }
  let worst = 0;
  for (const point of board) {
    const want = applyHomography(truth, point);
    const got = applyHomography(fitted, point);
    worst = Math.max(worst, Math.hypot(want.x - got.x, want.y - got.y));
  }
  // Expressed in pixels of a 1280-wide camera, which is what it has to mean.
  console.log(`${label.padEnd(34)} worst error ${(worst * 1280).toFixed(2)} px`);
}

report("exact points", homographyFromMany(board, clean));

// Sub-pixel matching noise, which is what patch tracking really returns.
const jittered = clean.map((p) => ({ x: p.x + (Math.random() - 0.5) * 0.002, y: p.y + (Math.random() - 0.5) * 0.002 }));
report("with matching jitter", homographyFromMany(board, jittered));

// Three anchors gone wrong: a hand landed on them and they matched something
// else nearby. Fitted naively, then with the trimmed refit the tracker uses.
const spoiled = jittered.map((p, i) => (i % 6 === 0 ? { x: p.x + 0.05, y: p.y - 0.04 } : p));
report("3 anchors wrong, naive fit", homographyFromMany(board, spoiled));

// What the tracker does: agree first, fit second.
const OUTLIER = 3 / 1280;
let bestInliers = [];
for (let attempt = 0; attempt < 60; attempt++) {
  const chosen = new Set();
  for (let guard = 0; guard < 40 && chosen.size < 4; guard++) chosen.add(Math.floor(Math.random() * board.length));
  if (chosen.size < 4) continue;
  const sample = [...chosen];
  const guess = homographyFrom(sample.map((i) => board[i]), sample.map((i) => spoiled[i]));
  if (!guess) continue;
  const inliers = [];
  for (let i = 0; i < board.length; i++) {
    const predicted = applyHomography(guess, board[i]);
    if (Math.hypot(predicted.x - spoiled[i].x, predicted.y - spoiled[i].y) <= OUTLIER) inliers.push(i);
  }
  if (inliers.length > bestInliers.length) bestInliers = inliers;
}
console.log(`  (consensus kept ${bestInliers.length} of ${board.length} anchors; 15 are good)`);
report(
  "3 anchors wrong, consensus fit",
  homographyFromMany(bestInliers.map((i) => board[i]), bestInliers.map((i) => spoiled[i])),
);

// --- The whole tracker over synthetic video ------------------------------------------
//
// A guitar drawn in board coordinates (fretboard with wires and strings, which
// repeat; a body with grain and a soundhole, which do not) is filmed through a
// known, moving homography over a static room, with two hands passing over it.
// NeckFollower is run on every frame as the app runs it, and its answer is
// compared with the truth. Two rules:
//   - a fit it gives must be right: where fingers go, within a quarter of
//     the 12th fret's box (`allowedError`), because a grid in the wrong place
//     teaches the wrong fret, and no grid at all with no guitar in sight;
//   - between a missed pass and "lost" the last grid stays up, stale: at
//     most two passes in a row;
//   - on smooth playing motion it must not lose the neck at all, and after
//     a jump it should find it again.

import { NeckFollower } from "../src/guitar/NeckFollower.ts";
import { GUITARS, fretLine, halfWidthAt } from "../src/guitar/geometry.ts";
import { invert } from "../src/vision/homography.ts";

const W = 320;
const H = 153;
/**
 * A miss is wrong past a quarter of the narrowest fret box shown, the 12th,
 * where the truth puts it now: within that a fingertip still reads on its own
 * fret. About 2 px on a neck that spans the picture; more when the student
 * leans in and it is bigger.
 */
function allowedError(want) {
  const a = applyHomography(want, { x: fretLine(11), y: 0 });
  const b = applyHomography(want, { x: fretLine(12), y: 0 });
  return Math.hypot(a.x - b.x, a.y - b.y) / 4;
}
const spec = GUITARS.acoustic;

function hash(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * The guitar's look at a board point, or null off the guitar. `look` (0-1) is
 * how far the camera has moved round it since the neck was marked, which a
 * flat picture of a guitar cannot show: figured wood shows different bands
 * from different angles, and the shine on the varnish moves with the eye.
 * (Leaning in over the guitar in a student's recording, BITACORA 2026-11-05.)
 * The strings, which sit above the frets and slide across them too, are left
 * still: then "where the neck is" has two answers, the wires' and the strings'.
 * The pearl dots in spaces 3, 5, 7, 9 and 15, and the pair in 12, are on most
 * guitars; `inlays = false` takes them away, for the guitars without.
 */
let inlays = true;
/** A soft shadow across the guitar, the student's own (0 none, 1 there): it darkens part of every stored picture, and not the rest. */
let shadow = 0;
const DOTS = [3, 5, 7, 9, 15].map((n) => [n, 0]).concat([[12, 0.34], [12, -0.34]]);
function guitar(p, look = 0) {
  const half = halfWidthAt(spec, p.x);
  if (p.x >= -0.01 && p.x <= 0.56 && Math.abs(p.y) <= half) {
    let v = 55 + 15 * ((1 - look) * noise(p.x * 300, p.y * 300, 1) + look * noise(p.x * 300, p.y * 300, 5));
    if (inlays) {
      for (const [n, at] of DOTS) {
        const x = (fretLine(n - 1) + fretLine(n)) / 2;
        if (Math.hypot((p.x - x) / 0.0045, (p.y - at * halfWidthAt(spec, x)) / 0.0045) < 1) v = 200;
      }
    }
    for (let f = 1; f <= 20; f++) if (Math.abs(p.x - fretLine(f)) < 0.0022) v = 205;
    if (p.x < 0.004) v = 230; // the nut
    for (let s = 0; s < 6; s++) if (Math.abs(p.y - (-half * 0.85 + (s * 1.7 * half) / 5)) < 0.0012) v = Math.max(v, 160);
    return (v + shine(p, look)) * shaded(p);
  }
  const bx = p.x - 0.555;
  const body = 0.2 + 0.1 * Math.sin(Math.min(1, Math.max(0, bx / 0.6)) * Math.PI);
  if (p.x > 0.555 && p.x < 1.2 && Math.abs(p.y) < body) {
    const r = Math.hypot(p.x - 0.72, p.y);
    if (r < 0.065) return 20;
    if (r < 0.09) return 120 + 80 * noise(Math.atan2(p.y, p.x - 0.72) * 12, r * 200, 3);
    if (Math.abs(p.y) > body - 0.008) return 220; // binding
    // Figured wood shows different bands from different angles (the grain's
    // fibres catch the light): the pattern seen fades into another one.
    const grain = look === 0 ? noise(p.x * 60, p.y * 18, 2) : (1 - look) * noise(p.x * 60, p.y * 18, 2) + look * noise(p.x * 60, p.y * 18, 4);
    return (90 + 50 * grain + shine(p, look)) * shaded(p);
  }
  return null;
}

/** How much light the shadow leaves at a board point: its edge runs slantwise across the neck, a few frets wide. */
function shaded(p) {
  if (shadow === 0) return 1;
  const across = (p.x - 0.18 + 2.5 * p.y) / 0.008;
  return 1 - (shadow * 0.75) / (1 + Math.exp(-across));
}

/** A broad highlight on the varnish, wherever the light bounces into the camera from: it moves along the guitar as the camera moves. */
function shine(p, look) {
  if (look === 0) return 0;
  const r = Math.hypot(p.x - (0.9 - 0.6 * look), (p.y - 0.06) * 2);
  return 70 * look * Math.exp(-((r / 0.08) ** 2));
}

function room(x, y) {
  return 140 + 60 * noise(x / 9, y / 9, 7) - 30 * noise(x / 3, y / 3, 8);
}

/** Board -> pixels for a pose: centre, angle, scale and how far the far end tips away. */
function pose(cx, cy, angle, scale, tip) {
  const board = [
    { x: 0, y: -0.04 },
    { x: 0, y: 0.04 },
    { x: 1, y: 0.04 },
    { x: 1, y: -0.04 },
  ];
  const len = 300 * scale;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (u, v) => ({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos });
  const near = 0.04 * len;
  const far = near * (1 - tip);
  return homographyFrom(board, [at(len * 0.45, -near), at(len * 0.45, near), at(-len * 0.55, far), at(-len * 0.55, -far)]);
}

function render(h, hands, seed, look = 0) {
  const back = invert(h);
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 3x3 samples per pixel: a camera's pixel averages the light over its area,
      // so a 1 px fret wire is a soft line, not one that blinks in and out.
      let v = 0;
      for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
          const px = x + sx / 3;
          const py = y + sy / 3;
          const hand = hands.find((hand) => Math.hypot(px - hand.x, py - hand.y) < hand.r);
          v += hand ? 175 + 25 * noise(px / 2, py / 2, 9) : guitar(applyHomography(back, { x: px, y: py }), look) ?? room(px, py);
        }
      }
      data[y * W + x] = Math.min(255, v / 9 + (hash(x, y, seed) - 0.5) * 6); // sensor noise; a highlight clips
    }
  }
  return { data, width: W, height: H };
}

/** The worst miss over where fingers go — the middle of each fret box, frets 1-12, on both outer strings — that is in the picture. */
const FINGER_SPOTS = [];
for (let f = 1; f <= 12; f++) {
  const x = (fretLine(f - 1) + fretLine(f)) / 2;
  for (const side of [1, -1]) FINGER_SPOTS.push({ x, y: side * halfWidthAt(spec, x) * 0.85 });
}
function errorOf(got, want) {
  let worst = 0;
  let seen = 0;
  for (const p of FINGER_SPOTS) {
    const b = applyHomography(want, p);
    if (b.x < 0 || b.y < 0 || b.x >= W || b.y >= H) continue;
    seen++;
    const a = applyHomography(got, p);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
  }
  // No neck in the picture: any grid at all is a wrong one.
  return seen > 0 ? worst : Infinity;
}

let trackFailures = 0;
/** `TRACK_DEBUG=leans npm run track-check` prints every frame of the scenarios whose name starts with that. */
const debug = (name) => process.env.TRACK_DEBUG && name.startsWith(process.env.TRACK_DEBUG);
function scenario(name, poses, handsAt, { mustHold, findAgain = Infinity, lookAt = () => 0, dots = true, mayStayLost = false, shadowAt = () => 0 }) {
  inlays = dots;
  shadow = shadowAt(0);
  const follower = new NeckFollower();
  const step = 1000 / 15;
  const box = (hand) => ({ x0: hand.x - hand.r, y0: hand.y - hand.r, x1: hand.x + hand.r, y1: hand.y + hand.r });
  // An arm is drawn but not boxed: hand tracking finds hands, not forearms.
  const boxes = (hands) => hands.filter((hand) => !hand.arm).map(box);
  follower.anchor(render(poses[0], handsAt(0), 0, lookAt(0)), poses[0], spec, 12, boxes(handsAt(0)), 0);
  let shown = poses[0];
  let wrong = 0;
  let stale = 0;
  let staleRun = 0;
  let lostFrames = 0;
  let lostRun = 0;
  let longestLoss = 0;
  let worst = 0;
  let total = 0;
  let counted = 0;
  for (let i = 1; i < poses.length; i++) {
    const hands = handsAt(i);
    shadow = shadowAt(i);
    const fit = follower.track(render(poses[i], hands, i, lookAt(i)), i * step, boxes(hands));
    if (fit) shown = fit;
    if (follower.lost(i * step)) {
      lostFrames++;
      lostRun++;
      if (debug(name)) console.log(i, "lost", follower.miss);
      longestLoss = Math.max(longestLoss, lostRun);
      continue;
    }
    lostRun = 0;
    const error = errorOf(shown, poses[i]);
    const allowed = allowedError(poses[i]);
    if (Number.isFinite(error)) {
      worst = Math.max(worst, error);
      total += error;
      counted++;
    }
    if (fit && error > allowed) wrong++;
    if (debug(name)) console.log(i, fit ? "fit" : "miss", `${error.toFixed(1)}/${allowed.toFixed(1)} px`, follower.miss, `${follower.agreed}/${follower.held} agreed, ${follower.learned} views learned, ${follower.byWires} by wires`);
    staleRun = !fit && error > allowed ? staleRun + 1 : 0;
    stale = Math.max(stale, staleRun);
  }
  const ok = wrong === 0 && stale <= 2 && (!mustHold || lostFrames === 0) && longestLoss <= findAgain && (mayStayLost || lostRun === 0);
  if (!ok) trackFailures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${follower.byWires} by wires, shown ${counted}/${poses.length - 1}, lost ${lostFrames}, wrong ${wrong}, stale ${stale}, mean ${(total / Math.max(1, counted)).toFixed(2)} px, worst ${worst.toFixed(2)} px`,
  );
}

const frames = (count, f) => Array.from({ length: count }, (_, i) => f(i / (count - 1), i));
const smooth = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
console.log("\nsynthetic video, 15 frames a second:");

scenario("still, hands strumming", frames(30, () => pose(170, 80, -0.3, 1, 0.1)), (i) => [
  { x: 250, y: 55, r: 14 },
  { x: 95 + 6 * Math.sin(i), y: 105 + 8 * Math.sin(i * 1.7), r: 18 },
], { mustHold: true });

scenario("slides and tips 20 deg in 4 s", frames(60, (t) => pose(160 + 30 * smooth(t), 82 - 10 * smooth(t), -0.3 + 0.35 * smooth(t), 1, 0.1 + 0.1 * smooth(t))), () => [], { mustHold: true });

scenario("comes closer, 25%", frames(45, (t) => pose(165, 80, -0.25, 1 + 0.25 * smooth(t), 0.1)), () => [], { mustHold: true });

scenario("quick move, 9 px a frame", frames(16, (t) => pose(140 + 135 * t, 85 - 20 * t, -0.3, 1, 0.1)), () => [], { mustHold: true });

// Teleported out of the search, turned and smaller: it may lose the neck for a
// moment, but must never show it in the wrong place, and must find it again.
scenario("jumps 90 px, turns 11deg", [...frames(10, () => pose(150, 80, -0.3, 1, 0.1)), ...frames(25, () => pose(240, 70, -0.1, 0.9, 0.1))], () => [], { mustHold: false, findAgain: 18 });

// Leaning in over the guitar (a student's recording, BITACORA 2026-11-05):
// over four seconds it comes half as big again, turns and tips, and the wood
// and its shine change as the camera goes round it. Then it is out of the
// picture for a second, and comes back where it went. Views are learned on
// the way, and each copies the error of the pass that learned it: no grid
// may be off for that, and it must be found again within a second of being
// back. (The real recording changed more than this scene can: there the
// learned views held the neck 0.9 s longer — BITACORA.)
const leanIn = [
  ...frames(60, (t) => pose(170 - 30 * smooth(t), 80 + 8 * smooth(t), -0.3 + 0.25 * smooth(t), 1 + 0.5 * smooth(t), 0.1 + 0.15 * smooth(t))),
  ...frames(15, () => pose(900, 80, -0.05, 1.5, 0.25)),
  ...frames(30, () => pose(150, 86, -0.07, 1.5, 0.25)),
];
const leanLook = (i) => Math.min(1, i / 59);
scenario("leans in, away 1 s, comes back", leanIn, () => [], { mustHold: false, findAgain: 30, lookAt: leanLook });

// The student shifts the guitar a little — a sixth of a fret box along the
// neck, a few pixels across, 7% bigger, in 0.2 s — and the light on it
// changes as it moves, so no picture stored of it matches any more (a
// student's recording, 54.3 s: BITACORA 2026-11-06). The wires are still
// there, and the dots say which fret is which: it must be found again within
// half a second. Without dots the wires cannot tell one fret from the next,
// and it must stay lost rather than guess.
const shift = () => [
  ...frames(15, () => pose(170, 80, -0.3, 1, 0.1)),
  ...frames(3, (t) => pose(170 - 20 * t, 80 + 7 * t, -0.3, 1 + 0.07 * t, 0.1)),
  ...frames(25, () => pose(150, 87, -0.3, 1.07, 0.1)),
];
const shiftLook = (i) => (i < 15 ? 0 : 1);
const shiftShadow = (i) => Math.min(1, Math.max(0, (i - 14) / 3));
scenario("shifts a little, light changes", shift(), () => [], { mustHold: false, findAgain: 8, lookAt: shiftLook, shadowAt: shiftShadow });
scenario("the same, a guitar without dots", shift(), () => [], { mustHold: false, lookAt: shiftLook, shadowAt: shiftShadow, dots: false, mayStayLost: true });

// The nut and the first frets slide out of the picture (on a laptop webcam,
// the student turns towards the strumming hand), while the strumming hand and
// forearm cover the soundhole and much of the body. What is left to see is
// the middle of the neck — where the lesson is.
const strumming = (i) => {
  const s = 5 * Math.sin(i * 1.3);
  return [
    { x: 92, y: 104 + s, r: 20 },
    ...[0, 1, 2, 3, 4].map((k) => ({ x: 15 + k * 18, y: 135 - k * 7 + s, r: 22, arm: true })),
  ];
};
scenario("nut slides out of the picture", [...frames(45, (t) => pose(170 + 75 * smooth(t), 80 - 6 * smooth(t), -0.3, 1, 0.1)), ...frames(30, () => pose(245, 74, -0.3, 1, 0.1))], strumming, { mustHold: true });

console.log(trackFailures === 0 ? "\nall good" : `\n${trackFailures} failed`);
process.exit(trackFailures === 0 ? 0 : 1);
