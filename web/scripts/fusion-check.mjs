/**
 * Checks audio + vision fusion without a camera or a guitar.
 *
 *   npm run fusion-check
 *
 * A neck is calibrated from four plausible camera corners (the real
 * `Fretboard`, the real homography), fingertips are placed on it in camera
 * coordinates with tracking jitter, projected back the way `FretReader` does,
 * and `fuse()` is asked where each heard note was played. Also: the open-string
 * rule, stale and missing readings, the wrong-spot confidence gate, and the
 * one-second fallback to audio-only.
 */

import { Fretboard } from "../src/guitar/Fretboard.ts";
import { GUITARS } from "../src/guitar/geometry.ts";
import { noteAt } from "../src/guitar/tuning.ts";
import { candidatesFor } from "../src/fusion/candidates.ts";
import { fuse, TipHistory, FUSE_TOLERANCE } from "../src/fusion/fuse.ts";
import { VisionHealth, NO_HAND_MS } from "../src/fusion/visionHealth.ts";
import { judgeNote, WRONG_SPOT_CONFIDENCE } from "../src/lesson/noteJudge.ts";
import { step } from "../src/lesson/exercises.ts";

const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${detail}`);
  if (!ok) failures.push(label);
}

// A webcam's view of an acoustic neck: nut on the right, 12th fret to the left,
// the far end a little smaller (it is further away). Camera coordinates 0..1.
const spec = GUITARS.acoustic;
const board = Fretboard.from(spec, [
  { x: 0.84, y: 0.47 }, // nut, thick E
  { x: 0.84, y: 0.56 }, // nut, thin E
  { x: 0.3, y: 0.6 }, // 12th, thin E
  { x: 0.29, y: 0.43 }, // 12th, thick E
]);

let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gaussian = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

/** String spacing at a fret, in camera units: what "jitter of 0.2 strings" means on screen. */
const spacingAt = (fret) => {
  const a = board.pointFor(1, fret);
  const b = board.pointFor(2, fret);
  return Math.hypot(a.x - b.x, a.y - b.y);
};

/** A constant error across the strings, in string spacings: the tip seen from an angle (FretReader's first limitation). */
let bias = 0;

/** A fingertip pressing (string, fret), as the camera would see it with `jitter` string spacings of noise. */
function tipAt(finger, string, fret, jitter) {
  const at = board.pointFor(string, fret);
  const across = board.pointFor(Math.min(6, string + 1), fret);
  const unit = spacingAt(Math.max(1, fret));
  const s = unit * jitter;
  const dir = { x: (across.x - at.x) / unit, y: (across.y - at.y) / unit };
  const camera = { x: at.x + gaussian() * s + dir.x * unit * bias, y: at.y + gaussian() * s + dir.y * unit * bias };
  return { finger, position: board.positionAt(camera), onBoard: board.covers(camera) };
}
const frame = (tips, atMs = 0) => ({ atMs, tips });
const options = { calibrated: true, maxFret: 15 };
const where = (f) => (f.source === "fused" ? `${f.string}/${f.fret} (${f.confidence.toFixed(2)})` : "audio-only");

// --- Candidates --------------------------------------------------------------

check(candidatesFor(64).map((c) => `${c.string}/${c.fret}`).join(" ") === "1/0 2/5 3/9 4/14 5/19 6/24", "E4 can be played in six places");
check(candidatesFor(40).length === 1 && candidatesFor(40)[0].string === 6, "the thick open E only in one");
check(candidatesFor(64, 12).length === 3, "a 12-fret limit leaves three");
check(candidatesFor(88)[0].fret === 24 && candidatesFor(89).length === 0, "E6 at the 24th, nothing above");

// --- The rules ------------------------------------------------------------------

{
  const fused = fuse(64, frame([tipAt(1, 2, 5, 0)]), options);
  check(fused.source === "fused" && fused.string === 2 && fused.fret === 5 && fused.confidence > 0.95, "a fingertip on B5 when E4 is heard → B string, 5th fret", where(fused));
  const open = fuse(64, frame([tipAt(1, 4, 2, 0), tipAt(2, 5, 2, 0)]), options);
  check(open.source === "fused" && open.string === 1 && open.fret === 0, "E4 heard, fingers elsewhere, thin E free → open string", where(open));
  const blocked = fuse(64, frame([tipAt(1, 1, 3, 0)]), options);
  check(blocked.source === "audio-only", "E4 heard while the thin E is pressed at fret 3 → audio-only", where(blocked));
  const noFrame = fuse(64, null, options);
  check(noFrame.source === "audio-only", "no hand reading near the pluck → audio-only");
  const uncalibrated = fuse(64, frame([tipAt(1, 2, 5, 0)]), { ...options, calibrated: false });
  check(uncalibrated.source === "audio-only", "no calibration → audio-only");
  const between = fuse(64, frame([tipAt(1, 2, 7, 0)]), options);
  check(between.source !== "fused" || between.fret === 0, "a finger two frets off is not taken as B5", where(between));
}

{
  const history = new TipHistory(300);
  for (let t = 0; t <= 1000; t += 33) history.push(frame([tipAt(1, 2, 5, 0)], t));
  check(history.closest(500)?.atMs === 495, "history: the frame nearest the pluck", `${history.closest(500)?.atMs} ms`);
  check(history.closest(1250) !== null && history.closest(1400) === null, "history: nothing older than 300 ms");
}

// --- Accuracy under tracking jitter ------------------------------------------------

/**
 * Realistic hands: the playing finger on the target, the other three hovering
 * over the next frets of the same string or the strings beside it (one finger
 * per fret), all with the same jitter.
 */
function accuracy(jitter, trials = 2000) {
  let right = 0;
  let wrong = 0;
  let audioOnly = 0;
  // What audio alone would say: the lowest fret the note can be played at.
  let naiveRight = 0;
  for (let i = 0; i < trials; i++) {
    const string = 1 + Math.floor(random() * 6);
    const fret = 1 + Math.floor(random() * 12);
    const midi = noteAt(string, fret);
    const playing = 1 + Math.floor(random() * 4);
    const tips = [1, 2, 3, 4].map((finger) => {
      if (finger === playing) return tipAt(finger, string, fret, jitter);
      const otherFret = Math.max(1, Math.min(15, fret + finger - playing));
      const otherString = Math.max(1, Math.min(6, string + (random() < 0.5 ? 0 : random() < 0.5 ? -1 : 1)));
      // Hovering fingers sit a little off the string they are over.
      const hover = tipAt(finger, otherString, otherFret, jitter);
      return random() < 0.3 ? { ...hover, onBoard: false } : hover;
    });
    const fused = fuse(midi, frame(tips), options);
    const naive = candidatesFor(midi, options.maxFret).reduce((a, b) => (b.fret < a.fret ? b : a));
    if (naive.string === string && naive.fret === fret) naiveRight++;
    if (fused.source !== "fused") audioOnly++;
    else if (fused.string === string && fused.fret === fret) right++;
    else wrong++;
  }
  const fusedCount = right + wrong;
  return { right, wrong, audioOnly, trials, ofFused: fusedCount ? right / fusedCount : 0, naive: naiveRight / trials };
}

for (const [jitter, minimum] of [
  [0.1, 0.99],
  [0.2, 0.97],
  [0.35, 0.9],
]) {
  const r = accuracy(jitter);
  check(
    r.ofFused >= minimum,
    `jitter ${jitter} strings: string/fret right when fused ≥ ${minimum * 100}%`,
    `${((100 * r.ofFused)).toFixed(1)}% of ${r.right + r.wrong} fused, ${r.audioOnly} audio-only of ${r.trials}`,
  );
}

{
  bias = 0.4;
  const r = accuracy(0.2);
  bias = 0;
  check(r.ofFused >= 0.9, "parallax: every tip 0.4 strings off, jitter 0.2 → still ≥ 90%", `${(100 * r.ofFused).toFixed(1)}% of ${r.right + r.wrong} fused, ${r.audioOnly} audio-only`);
  const plain = accuracy(0.2);
  console.log(
    `info string/fret right, positions spread over frets 1-12: audio alone (lowest fret) ${(100 * plain.naive).toFixed(1)}%, ` +
      `fused ${((100 * plain.right) / plain.trials).toFixed(1)}% of all notes (${plain.audioOnly} fell back to audio-only)`,
  );
}

// --- Wrong spot ----------------------------------------------------------------------

{
  const b5 = step(2, 5, 0);
  const at = (place) => judgeNote(b5, { kind: "note", midi: 64, onsetMs: 0, rms: 0.1, confidence: 0.99, place }, { dueMs: null, windowMs: 150 });
  check(at({ source: "fused", string: 3, fret: 9, confidence: 0.95 }).state === "wrongSpot", "E4 on G9 when B5 was asked, vision sure → wrong spot");
  check(at({ source: "fused", string: 3, fret: 9, confidence: WRONG_SPOT_CONFIDENCE - 0.01 }).state === "clean", "the same, vision unsure → clean (judged by ear)");
  check(at({ source: "fused", string: 1, fret: 0, confidence: 0.65 }).state === "clean", "an open string is never confident enough to overrule");
  check(at({ source: "audio-only", string: null, fret: null, confidence: 0 }).state === "clean", "audio-only → clean, never wrong spot");
  check(at({ source: "fused", string: 2, fret: 5, confidence: 0.9 }).source === "fused", "a fused verdict says so");
}

// --- Fallback --------------------------------------------------------------------------

{
  const health = new VisionHealth();
  check(health.mode(0) === "audio-only" && health.reason(0) === "noCamera", "no camera → audio-only");
  health.frame(0, true, true);
  check(health.mode(NO_HAND_MS - 100) === "fused", "hand seen 0.9 s ago → still fused");
  check(health.mode(NO_HAND_MS + 100) === "audio-only" && health.reason(NO_HAND_MS + 100) === "noHand", "no hand for 1.1 s → audio-only");
  health.frame(NO_HAND_MS + 200, true, true);
  check(health.mode(NO_HAND_MS + 200) === "fused", "hand back → fused again, by itself");
  health.frame(NO_HAND_MS + 300, true, false);
  check(health.reason(NO_HAND_MS + 300) === "noCalibration", "calibration lost → audio-only");
}

console.log(`\ntolerance ${FUSE_TOLERANCE} neck units, wrong spot needs confidence ${WRONG_SPOT_CONFIDENCE}`);
console.log(failures.length ? `${failures.length} FAILED` : "all good");
process.exit(failures.length ? 1 : 0);
