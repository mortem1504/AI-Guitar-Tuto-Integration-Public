/**
 * Checks the single-note lessons without a guitar.
 *
 *   npm run lesson-check
 *
 * Plays whole sessions through `NoteSession` with scripted note events, in
 * both modes, and checks the judge's six states, the timing zones, pausing,
 * the review summary, "practise mistakes", and that stored sessions survive a
 * round trip and that hostile ones are rejected.
 */

import { exerciseProblems, mistakesExercise, NOTE_EXERCISES, step } from "../src/lesson/exercises.ts";
import { fretMove, judgeNote, octavesAway, WEAK_PEAK } from "../src/lesson/noteJudge.ts";
import { ARRIVAL_SLACK_MS, COUNT_IN_BEATS, LOOP_IDLE_MS, NoteSession, summarize } from "../src/lesson/NoteSession.ts";
import { parseRecord, recordOf } from "../src/lesson/sessionStore.ts";

const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(56)} ${detail}`);
  if (!ok) failures.push(label);
}

const note = (midi, onsetMs, rms = 0.05) => ({ kind: "note", midi, onsetMs, rms, confidence: 0.98 });
const unclear = (onsetMs, rms = 0.05) => ({ kind: "unclear", onsetMs, rms });
const states = (session) => session.judged.map((j) => j.verdict.state).join(",");
/** Detection lands this long after the pluck (Phase 1's p50). */
const ARRIVE = 64;

// --- Exercises ---------------------------------------------------------------

const problems = NOTE_EXERCISES.flatMap(exerciseProblems);
check(problems.length === 0, "the six seed exercises are consistent", problems.join("; ") || `${NOTE_EXERCISES.length} exercises`);
check(NOTE_EXERCISES.length === 6, "six seeds, as on the slides");
const ode = NOTE_EXERCISES.find((e) => e.id === "ode");
check(ode.steps.map((s) => s.midi).join(" ") === "64 64 65 67 67 65 64 62 60 60 62 64 64 62 62", "Ode to Joy is E E F G G F E D C C D E E D D");

// --- The judge ---------------------------------------------------------------

const e4 = step(1, 0, 0);
const verdictOf = (attempt, dueMs = null) => judgeNote(e4, attempt, { dueMs, windowMs: 150 });
check(verdictOf(note(64, 0)).state === "clean", "right note: clean");
check(verdictOf(note(65, 0)).state === "wrongNote" && verdictOf(note(65, 0)).counts, "another note: wrongNote, counted");
check(verdictOf(note(64, 1200), 1000).state === "timing", "right note 200 ms late: timing", `${verdictOf(note(64, 1200), 1000).offsetMs} ms`);
check(verdictOf(note(64, 1100), 1000).state === "clean", "right note 100 ms late: clean");
check(verdictOf(note(64, 860), 1000).offsetMs === -140, "early is a negative offset");
check(verdictOf(unclear(0)).state === "notCaught" && !verdictOf(unclear(0)).counts, "pitchless onset: notCaught, not counted");
check(verdictOf(unclear(0, 0.001)).state === "weakSignal", "very quiet onset: weakSignal");
check(verdictOf({ kind: "none", peak: WEAK_PEAK / 2 }).state === "weakSignal", "silence: weakSignal");
check(verdictOf({ kind: "none", peak: 0.2 }).state === "notCaught", "loud but no onset: notCaught");
check(fretMove(65, step(1, 0, 0)) === -1 && fretMove(64, step(1, 2, 0)) === 2, "fret moves: back one, up two");
check(fretMove(57, step(1, 0, 0)) === null, "unreachable on the string: no fret move");
check(octavesAway(76, 64) === 1 && octavesAway(52, 64) === -1 && octavesAway(65, 64) === 0, "octave mistakes are named");

// --- Loop mode -----------------------------------------------------------------

const roll = NOTE_EXERCISES[0];
{
  const start = 1000;
  const s = new NoteSession(roll, "loop", start);
  const playing = start + COUNT_IN_BEATS * s.beat;
  check(s.phase(start) === "countIn" && s.countInLeft(start) === 3, "loop: count-in first", `${s.countInTimes().map((t) => t - start).join(",")} ms`);
  check(s.hear(note(40, start + 100), start + 200) === null, "loop: a note during the count-in is ignored");
  check(s.phase(playing) === "playing", "loop: then playing");
  s.hear(note(41, playing + 500), playing + 560);
  s.hear(unclear(playing + 900), playing + 960);
  s.hear(note(40, playing + 1300), playing + 1360);
  check(s.current === 1 && states(s) === "wrongNote,notCaught,clean", "loop: wrong, unclear, right → next note", states(s));
  s.skip(playing + 1400);
  check(s.current === 2, "loop: skip moves on");
  const idle = s.tick(playing + 1400 + LOOP_IDLE_MS + 10, 0.001, 0);
  check(idle.length === 1 && idle[0].state === "weakSignal", "loop: five silent seconds → weakSignal");
  const loud = s.tick(playing + 1400 + 2 * LOOP_IDLE_MS + 20, 0.3, 0);
  check(loud.length === 0, "loop: five loud seconds with no note → no nagging");
  let t = playing + 20000;
  for (let i = 2; i < roll.steps.length; i++) s.hear(note(roll.steps[i].midi, (t += 1000)), t + ARRIVE);
  check(s.finished, "loop: finishes after the last note");
  const summary = summarize(s);
  check(
    summary.attempted === roll.steps.length && summary.clean === roll.steps.length - 1 && summary.mistakes === 1,
    "loop summary: one mistake, skip not attempted",
    `${summary.clean}/${summary.attempted}, skipped ${summary.skipped}`,
  );
  check(summary.missedSteps.join(",") === "0,1", "loop summary: missed steps are the wrong one and the skipped one");
  const again = mistakesExercise(roll, summary.missedSteps);
  check(again && again.steps.length === 2 && exerciseProblems(again).length === 0, "practise mistakes: the two missed notes");
}

// --- Play-through ---------------------------------------------------------------

function playThrough(exercise, play, untilMs) {
  const start = 0;
  const s = new NoteSession(exercise, "playThrough", start);
  const events = play(s).sort((a, b) => a.arrive - b.arrive);
  for (let now = 0, next = 0; now <= untilMs; now += 50) {
    while (next < events.length && events[next].arrive <= now) s.hear(events[next++].attempt, now);
    s.tick(now, 0.2, now);
  }
  return s;
}

const highE = NOTE_EXERCISES[1];
const end = (s) => s.dueOf(s.steps.length - 1) + s.beat + ARRIVAL_SLACK_MS + 100;
{
  const perfect = playThrough(highE, (s) => s.steps.map((st, i) => ({ attempt: note(st.midi, s.dueOf(i) + 30), arrive: s.dueOf(i) + 30 + ARRIVE })), 30000);
  check(perfect.finished && summarize(perfect).accuracy === 1, "play-through: on time throughout → all clean", states(perfect).split(",").length + " notes");

  const jittery = playThrough(
    highE,
    (s) =>
      s.steps.map((st, i) => {
        const offsets = [0, 200, -200, 0, 140, -140];
        const onset = s.dueOf(i) + offsets[i % offsets.length];
        return { attempt: note(st.midi, onset), arrive: onset + ARRIVE };
      }),
    30000,
  );
  const timing = jittery.judged.filter((j) => j.verdict.state === "timing").map((j) => j.verdict.offsetMs);
  check(timing.length > 0 && timing.every((ms) => Math.abs(ms) === 200), "play-through: ±200 ms is early/late, ±140 is clean", `offsets ${[...new Set(timing)].join(",")}`);

  const gaps = playThrough(
    highE,
    (s) => s.steps.flatMap((st, i) => (i % 2 ? [] : [{ attempt: note(st.midi, s.dueOf(i)), arrive: s.dueOf(i) + ARRIVE }])),
    30000,
  );
  check(
    gaps.finished && summarize(gaps).notCaught === Math.floor(highE.steps.length / 2) && summarize(gaps).accuracy === 1,
    "play-through: unplayed notes are judged when their zone closes",
    `${summarize(gaps).notCaught} not caught (the input was loud), accuracy ${summarize(gaps).accuracy}`,
  );

  const recovered = playThrough(
    highE,
    (s) => [
      { attempt: unclear(s.dueOf(0) - 20), arrive: s.dueOf(0) + 40 },
      { attempt: note(highE.steps[0].midi, s.dueOf(0) + 60), arrive: s.dueOf(0) + 60 + ARRIVE },
      { attempt: note(99, s.dueOf(0) + 100), arrive: s.dueOf(0) + 100 + ARRIVE },
    ],
    30000,
  );
  check(recovered.judged[0].verdict.state === "clean", "play-through: unclear then clear in one zone → the clear one");
  check(recovered.judged.filter((j) => j.index === 0).length === 1, "play-through: a second pluck in a judged zone is ignored");

  const laggy = playThrough(highE, (s) => [{ attempt: note(highE.steps[0].midi, s.dueOf(0) + 400), arrive: s.dueOf(0) + 400 + 250 }], 30000);
  check(laggy.judged[0].verdict.state === "timing", "play-through: a message landing after its zone still counts for it", `${laggy.judged[0].verdict.offsetMs} ms`);
}

{
  const s = new NoteSession(highE, "playThrough", 0);
  const due2 = s.dueOf(2);
  s.hear(note(highE.steps[0].midi, s.dueOf(0)), s.dueOf(0) + ARRIVE);
  s.pause(s.dueOf(1) - 100);
  check(s.phase(s.dueOf(1)) === "paused" && s.tick(due2 + 5000, 0, due2).length === 0, "pause: the clock stops");
  s.resume(100000);
  check(s.phase(100000) === "countIn" && s.dueOf(1) === 100000 + COUNT_IN_BEATS * s.beat, "resume: count-in again, then the next note", `due ${s.dueOf(1) - 100000} ms after resume`);
}

{
  // The loop toggle on the live screen, both ways, mid-exercise.
  const s = new NoteSession(highE, "loop", 0);
  const playing = COUNT_IN_BEATS * s.beat;
  s.hear(note(highE.steps[0].midi, playing + 100), playing + 100 + ARRIVE);
  s.hear(note(highE.steps[1].midi + 1, playing + 900), playing + 900 + ARRIVE);
  s.setMode("playThrough", 20000);
  check(s.mode === "playThrough" && s.current === 1 && s.dueOf(1) === 20000 + COUNT_IN_BEATS * s.beat, "loop → play through: from the same note, after a count-in");
  s.hear(note(highE.steps[1].midi, s.dueOf(1)), s.dueOf(1) + ARRIVE);
  check(s.current === 2 && states(s) === "clean,wrongNote,clean", "…and is timed from there", states(s));
  s.setMode("loop", 40000);
  check(s.mode === "loop" && s.dueOf(2) === null && s.phase(40000) === "countIn", "play through → loop: no clock, count-in again");
  check(summarize(s).attempted === 3, "the notes before the switch stay in the review");
}

// --- Stored sessions ---------------------------------------------------------------

{
  const s = playThrough(highE, (x) => x.steps.map((st, i) => ({ attempt: note(i === 3 ? st.midi + 1 : st.midi, x.dueOf(i)), arrive: x.dueOf(i) + ARRIVE })), 30000);
  const record = recordOf(summarize(s), { exerciseId: "highE", mode: "playThrough", tempo: 60, steps: highE.steps.length, startedAt: Date.now(), latency: { p50: 70, p95: 110, count: 11 } });
  const back = parseRecord(JSON.parse(JSON.stringify(record)));
  check(JSON.stringify(back) === JSON.stringify(record), "a stored session survives a round trip", `${record.timeline.length} mistake, most missed ${record.mostMissed?.midi}`);
  check(parseRecord({ ...record, mode: "<img>" }) === null, "hostile: an unknown mode is rejected");
  check(parseRecord({ ...record, exerciseId: "x\"><script>" }) === null, "hostile: a markup-ish id is rejected");
  check(parseRecord({ ...record, accuracy: 7 }).accuracy === 1, "hostile: accuracy is clamped");
  check(parseRecord({ ...record, timeline: [{ junk: 1 }, ...record.timeline] }).timeline.length === record.timeline.length, "hostile: junk timeline entries are dropped");
  check(parseRecord("nope") === null && parseRecord(null) === null, "hostile: not an object → nothing");
  check(recordOf(summarize(s), { exerciseId: "highE.mistakes", mode: "loop", tempo: 60, steps: 3, startedAt: 1, latency: null }).exerciseId === "highE", "a mistakes run is filed under its exercise");
}

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall good");
process.exit(failures.length ? 1 : 0);
