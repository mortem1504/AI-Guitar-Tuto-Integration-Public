/**
 * Checks the dashboard's rules without a browser.
 *
 *   npm run home-check
 *
 * The onboarding profile read back as hostile input, the rule-based
 * recommendations for each kind of student and history, "continue", and the
 * accuracy trend; the setup screen's verdicts and the live screen's signal line.
 */

import { parseProfile } from "../src/lesson/profile.ts";
import { accuracyTrend, continueWith, isMastered, recommend } from "../src/lesson/recommend.ts";
import { levelVerdict, lightVerdict, noiseVerdict, noteTestVerdict } from "../src/audio/setupChecks.ts";
import { SignalQuality, QUIET_AFTER_MS, CLIP_HOLD_MS } from "../src/audio/signalQuality.ts";
import { cameraProblem, ModelLoadError } from "../src/vision/cameraError.ts";

const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(64)} ${detail}`);
  if (!ok) failures.push(label);
}

let clock = 1_800_000_000_000;
/** A stored session, newest given last to `history` (which returns newest first, like listSessions). */
const run = (exerciseId, accuracy, extra = {}) => ({
  id: `r${clock}`,
  exerciseId,
  mistakesOnly: false,
  mode: "loop",
  tempo: 60,
  startedAt: (clock += 86_400_000),
  durationMs: 60_000,
  steps: 10,
  attempted: 10,
  clean: Math.round(accuracy * 10),
  mistakes: 10 - Math.round(accuracy * 10),
  notCaught: 0,
  weakSignal: 0,
  skipped: 0,
  accuracy,
  mostMissed: null,
  timeline: [],
  latency: null,
  fusedNotes: 0,
  fusedAtTarget: 0,
  ...extra,
});
const history = (...runs) => runs.reverse();
const ids = (list) => list.map((r) => r.exerciseId);

// --- Profile ----------------------------------------------------------------

check(parseProfile({ level: "new", goal: "solos", style: "blues" })?.goal === "solos", "a complete profile reads back");
check(parseProfile({ level: "expert", goal: "solos", style: "blues" }) === null, "an unknown level is not a profile");
check(parseProfile({ level: "new", goal: "solos" }) === null, "a missing answer is not a profile");
check(parseProfile("new") === null && parseProfile(null) === null && parseProfile([]) === null, "junk is not a profile");
check(!("extra" in (parseProfile({ level: "new", goal: "chords", style: "pop", extra: "<img>" }) ?? {})), "unknown fields are dropped");

// --- Recommendations --------------------------------------------------------

{
  const first = recommend(null, []);
  check(first[0].exerciseId === "openStrings" && first[0].reason === "start", "no profile, no history → open strings first", ids(first).join(" "));
  const beginner = recommend({ level: "new", goal: "melodies", style: "folk" }, []);
  check(beginner[0].exerciseId === "ode" || beginner[0].exerciseId === "openStrings", "new + melodies → open strings or the melody first", ids(beginner).join(" "));
  check(beginner.findIndex((r) => r.exerciseId === "spider") > 3, "new player: the spider is not near the top");
  const shredder = recommend({ level: "regular", goal: "solos", style: "rock" }, []);
  check(shredder[0].exerciseId === "pentatonic" && shredder[0].reason !== "level", "regular + solos + rock → pentatonic first, for a reason", `${shredder[0].exerciseId} (${shredder[0].reason})`);
  check(shredder.at(-1).exerciseId === "openStrings", "regular player: open strings last");
  check(new Set(ids(shredder)).size === 6, "every exercise is listed once");
}
{
  const profile = { level: "new", goal: "melodies", style: "folk" };
  const struggling = recommend(profile, history(run("openStrings", 0.95), run("gMajor", 0.5)));
  check(struggling[0].exerciseId === "gMajor" && struggling[0].reason === "retry", "a 50% run comes back to the top as 'worth another go'", ids(struggling).join(" "));
  const done = history(run("openStrings", 0.92), run("openStrings", 0.95));
  check(isMastered(done, "openStrings"), "two runs ≥ 90% is mastered");
  check(!isMastered(history(run("openStrings", 0.95)), "openStrings"), "one lucky run is not");
  const after = recommend(null, done);
  check(after.at(-1).exerciseId === "openStrings" && after.at(-1).reason === "mastered", "a mastered exercise drops to the bottom", ids(after).join(" "));
  const mistakesOnly = recommend(null, history(run("openStrings", 0.3, { mistakesOnly: true })));
  check(mistakesOnly[0].reason !== "retry", "a 'practise mistakes' run does not count as a full run");
  const stable = recommend(null, []);
  check(ids(stable).join() === ids(recommend(null, [])).join(), "the same input gives the same order");
}

// --- Continue and trend -----------------------------------------------------

check(continueWith([]) === null, "nothing to continue with no history");
{
  const records = history(run("highE", 0.6), run("spider", 0.8));
  check(continueWith(records)?.exerciseId === "spider", "continue: the newest session's exercise");
  const rising = accuracyTrend(history(...[0.5, 0.55, 0.6, 0.7, 0.8, 0.85].map((a) => run("highE", a))));
  check(rising.points[0] === 0.5 && rising.points.at(-1) === 0.85, "trend: oldest first", rising.points.join(" "));
  check(rising.change !== null && rising.change > 0.2, "trend: a rising run reads as rising", rising.change?.toFixed(2));
  check(accuracyTrend(history(run("highE", 0.5), run("highE", 0.9))).change === null, "trend: under four sessions says nothing");
  const empty = accuracyTrend(history(run("highE", 0, { attempted: 0 }), ...[1, 2, 3, 4].map(() => run("highE", 0.8))));
  check(empty.points.length === 4, "trend: sessions with no notes are left out");
  check(accuracyTrend(history(...Array.from({ length: 30 }, () => run("highE", 0.7)))).points.length === 12, "trend: the last twelve");
}

// --- Setup checks ---------------------------------------------------------------

check(levelVerdict(0.002) === "waiting" && levelVerdict(0.02) === "quiet" && levelVerdict(0.2) === "good" && levelVerdict(1) === "clipping", "level: waiting, quiet, good, clipping");
check(noiseVerdict([]) === null, "noise: nothing measured, no verdict");
check(noiseVerdict([0.0003, 0.0004, 0.0005])?.verdict === "quiet", "noise: -68 dBFS is a quiet room");
check(noiseVerdict([0.002, 0.002, 0.2])?.verdict === "fair", "noise: a cough does not decide (median)");
check(noiseVerdict([0.01, 0.01, 0.01])?.verdict === "noisy", "noise: -40 dBFS is noisy");
check(noteTestVerdict(45) === "ok" && noteTestVerdict(57) === "octave" && noteTestVerdict(33) === "octave" && noteTestVerdict(46) === "off", "note test: A2 ok, A3/A1 octave, A#2 off");
check(lightVerdict(0.1) === "dark" && lightVerdict(0.45) === "ok" && lightVerdict(0.9) === "bright", "light: dark, ok, bright");

// --- Signal line ---------------------------------------------------------------

{
  const signal = new SignalQuality();
  signal.add(0, 0.001);
  check(signal.state(1000) === "good", "signal: no verdict of quiet in the first seconds");
  for (let t = 0; t <= QUIET_AFTER_MS + 500; t += 46) signal.add(t, 0.001);
  check(signal.state(QUIET_AFTER_MS + 500) === "quiet", "signal: five seconds of nothing → can't hear the guitar");
  signal.add(QUIET_AFTER_MS + 600, 0.3);
  check(signal.state(QUIET_AFTER_MS + 600) === "good", "signal: a pluck → good again");
  signal.add(9000, 1);
  check(signal.state(9000 + CLIP_HOLD_MS - 100) === "clipping" && signal.state(9000 + CLIP_HOLD_MS + 100) !== "clipping", "signal: a clip is held two seconds, then let go");
}

// --- Camera errors -------------------------------------------------------------

{
  const named = (name) => ({ name, message: "" });
  check(cameraProblem(named("NotAllowedError"), true, true) === "blocked", "camera: denied → blocked, with where to allow it");
  check(cameraProblem(named("NotFoundError"), true, true) === "missing", "camera: none → missing");
  check(cameraProblem(named("NotReadableError"), true, true) === "busy", "camera: held by another app → busy");
  check(cameraProblem(new TypeError("x"), false, false) === "insecure", "camera: http on a network address → insecure");
  check(cameraProblem(new ModelLoadError("fetch failed"), true, true) === "model", "camera fine, model not downloaded → model");
  check(cameraProblem(new Error("odd"), true, true) === "other", "anything else → the browser's own message");
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall good");
process.exit(failures.length ? 1 : 0);
