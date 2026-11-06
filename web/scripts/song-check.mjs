/**
 * Checks the song library and the song lessons: stored and imported songs
 * read back as hostile input, the export file's round trip, plan steps turned
 * into note exercises (chords and dead notes left ungraded, rhythm kept),
 * whole runs played through the real NoteSession, and what a run does to the
 * progress (the tempo rule, mastery, continue).
 *
 *   npm run song-check
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { breakDown } from "../src/song/breakdown.ts";
import { importScore } from "../src/song/importers/score.ts";
import { exportFileName, exportText, importText, MAX_FILE_BYTES, newRecord, parseSong, parseSongRecord } from "../src/song/library.ts";
import { chunkMastery, exerciseFor, firstStepOf, gradedNote, recordRun, sectionMastery, stepEvents, tempoFor, wasClean } from "../src/song/lesson.ts";
import { teachingPlan } from "../src/song/plan.ts";
import { parseTextTab } from "../src/song/textTab.ts";
import { NoteSession } from "../src/lesson/NoteSession.ts";

const DIR = join(process.cwd(), "test", "tabs");
const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(52)} ${detail}`);
  if (!ok) failures.push(label);
}
const text = (name) => parseTextTab(readFileSync(join(DIR, name), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

// --- Reading songs back ---------------------------------------------------------------

const ode = text("16-ode-to-joy.txt");
const capo = text("06-capo.txt");
const score = (await importScore(new Uint8Array(readFileSync(join(DIR, "20-waltz-steps.gp"))), "20-waltz-steps.gp")).song;
for (const [name, song] of [["text tab", ode], ["capo tab", capo], ["Guitar Pro", score]]) {
  const back = parseSong(clone(song));
  check(back !== null && JSON.stringify(back.events) === JSON.stringify(song.events), `${name}: survives storage unchanged`, `${song.events.length} events`);
}

{
  const lied = clone(ode);
  lied.events[0].notes[0].midi = 99;
  check(parseSong(lied).events[0].notes[0].midi === ode.events[0].notes[0].midi, "a stored pitch is recomputed, never trusted");
  const bad = [
    ["not an object", 7],
    ["a seventh string", { ...clone(ode), events: [{ ...clone(ode.events[0]), notes: [{ string: 7, fret: 0, techniques: [] }] }] }],
    ["fret 99", { ...clone(ode), events: [{ ...clone(ode.events[0]), notes: [{ string: 1, fret: 99, techniques: [] }] }] }],
    ["two notes on one string", { ...clone(ode), events: [{ ...clone(ode.events[0]), notes: [{ string: 1, fret: 0, techniques: [] }, { string: 1, fret: 2, techniques: [] }] }] }],
    ["five strings of tuning", { ...clone(ode), tuning: ["E2", "A2", "D3", "G3", "B3"] }],
    ["a tuning of nonsense", { ...clone(ode), tuning: ["E2", "A2", "D3", "G3", "B3", "<b>"] }],
    ["an open string at C9", { ...clone(ode), tuning: ["E2", "A2", "D3", "G3", "B3", "C9"] }],
    ["capo 40", { ...clone(ode), capo: 40 }],
    ["tempo as text", { ...clone(ode), tempo: "fast" }],
    ["beats going backwards", { ...clone(score), events: [...clone(score.events)].reverse() }],
    ["rhythm on half the notes", { ...clone(score), events: clone(score.events).map((e, i) => (i % 2 ? { ...e, beat: null, durationBeats: null } : e)) }],
    ["too many events", { ...clone(ode), events: Array.from({ length: 20001 }, () => clone(ode.events[0])) }],
  ];
  for (const [label, value] of bad) check(parseSong(value) === null, `rejected: ${label}`);
  const odd = { ...clone(ode), title: "x\u0000y".repeat(100), techniques: undefined, labels: [{ name: "Intro", beforeEvent: 999, sourceLine: 1 }, "junk"], warnings: [42, "kept"] };
  odd.events[0].notes[0].techniques = ["bend", "explode", "bend"];
  const read = parseSong(odd);
  check(read && read.title.length <= 120 && !/\u0000/.test(read.title), "titles cut and cleaned of control characters");
  check(read && read.labels.length === 0 && read.warnings.join() === "kept", "labels past the end and non-text warnings dropped");
  check(read && read.events[0].notes[0].techniques.join() === "bend", "unknown techniques dropped, duplicates merged");
}

{
  const record = newRecord(ode, "ode.txt", 1_700_000_000_000);
  record.progress = { step: 3, tempo: { percent: 70, clean: 1, failed: 0 }, chunks: [{ runs: 4, cleanRuns: 2, bestPercent: 70 }] };
  record.sectionNames = ["Verse"];
  check(JSON.stringify(parseSongRecord(clone(record))) === JSON.stringify(record), "a record survives storage unchanged");
  check(parseSongRecord({ ...clone(record), id: "../../etc" }) === null, "a record with a strange id is dropped");
  const hostile = parseSongRecord({ ...clone(record), progress: { step: -4, tempo: { percent: 500, clean: 1, failed: 0 }, chunks: [{ runs: 2, cleanRuns: 9, bestPercent: 60 }, "x"] } });
  check(hostile.progress.step === 0 && hostile.progress.tempo === null, "impossible progress falls back to the start");
  check(hostile.progress.chunks[0].cleanRuns === 2 && hostile.progress.chunks[1].runs === 0, "more clean runs than runs is clamped; junk chunks reset");

  const file = exportText(record);
  const again = importText(file, 1_800_000_000_000);
  check(again && again.id !== record.id && JSON.stringify(again.song) === JSON.stringify(record.song), "export → import: same song, new id");
  check(again && again.progress.step === 3 && again.sectionNames[0] === "Verse", "export → import: progress and section names kept");
  check(importText("{not json", 0) === null && importText(JSON.stringify({ format: "other", version: 1 }), 0) === null, "a broken or foreign file is refused");
  check(importText(" ".repeat(MAX_FILE_BYTES + 1), 0) === null, "a file over 5 MB is refused before parsing");
  check(exportFileName({ ...record, song: { ...ode, title: "Ödë / to: <Joy>" } }) === "ode-to-joy.song.json", "export file names are safe", exportFileName({ ...record, song: { ...ode, title: "Ödë / to: <Joy>" } }));
}

// --- Plan steps as exercises ----------------------------------------------------------

const chords = text("04-chords.txt");
{
  const bd = breakDown(chords);
  const plan = teachingPlan(bd);
  const whole = plan.steps.at(-1);
  const made = exerciseFor("x", bd, plan, whole, 100);
  const graded = bd.song.events.filter((e) => gradedNote(e)).length;
  check(made.exercise.steps.length === graded && made.listenOnly === bd.song.events.length - graded, "chords are listen-only, single notes graded", `${graded} graded, ${made.listenOnly} listen-only`);
  check(made.eventOf.every((e) => bd.song.events[e].notes.length === 1), "every graded step is a single note");
}
{
  const bd = breakDown(score);
  const plan = teachingPlan(bd);
  const whole = plan.steps.at(-1);
  const made = exerciseFor("x", bd, plan, whole, 100);
  const events = bd.song.events;
  const kept = made.exercise.steps.every((s, k) => Math.abs(s.beat - (events[made.eventOf[k]].beat - events[made.eventOf[0]].beat)) < 1e-9);
  check(kept, "a score keeps its rhythm in beats", `last on beat ${made.exercise.steps.at(-1).beat}`);
  check(made.exercise.tempo === Math.round((plan.targetTempo * 100) / 100), "full speed is the song's tempo", `${made.exercise.tempo} bpm`);
  check(exerciseFor("x", bd, plan, whole, 60).exercise.tempo === Math.round(plan.targetTempo * 0.6), "60% is 60% of it");
}
{
  const bd = breakDown(ode);
  const plan = teachingPlan(bd);
  const meet = plan.steps[0];
  const made = exerciseFor("x", bd, plan, meet, 60);
  check(meet.kind === "meet" && made.exercise.steps.length === meet.events.length, "meet the notes: one step per new position", `${meet.events.length} new`);
  check(made.exercise.steps.every((s, i) => s.beat === i), "meet the notes: an even pulse");
  const spot = { ...plan.steps[1], kind: "hotSpot", fromEvent: 3, toEvent: 4, loop: true };
  check(stepEvents(spot).join() === "3,4,3,4,3,4,3,4", "a hot spot is its two notes four times");
  check(firstStepOf(plan, 0) === 0, "a section's first step is found");
}
{
  const bends = text("17-bends.txt");
  const study = breakDown(text("03-techniques.txt"));
  const studyPlan = teachingPlan(study);
  const legato = exerciseFor("x", study, studyPlan, studyPlan.steps.at(-1), 100);
  const bd = breakDown(bends);
  const plan = teachingPlan(bd);
  const made = exerciseFor("x", bd, plan, plan.steps.at(-1), 100);
  const bent = made.exercise.steps.findIndex((_, k) => bd.song.events[made.eventOf[k]].notes[0].techniques.includes("bend"));
  const note = bd.song.events[made.eventOf[bent]]?.notes[0];
  check(bent >= 0 && made.alsoAccept[bent] === note.midi + Math.round(note.bendSemitones), "a bend accepts its picked note and its target", note ? `${note.midi} or ${made.alsoAccept[bent]}` : "");
  check(legato.legato.size > 0, "hammer-ons, pull-offs and slides are marked legato", `${legato.legato.size} steps`);
}

// --- Whole runs through the real session ----------------------------------------------

const note = (midi, onsetMs) => ({ kind: "note", midi, onsetMs, rms: 0.1, confidence: 0.9 });
function run(made, mode, play) {
  const s = new NoteSession(made.exercise, mode, 0);
  for (let now = 0; now < 120000 && !s.finished; now += 50) {
    const i = s.current;
    const attempt = play(s, i, now);
    if (attempt) s.hear(attempt, now + 80);
    s.tick(now, 0.2, now);
  }
  return s;
}
{
  const bd = breakDown(ode);
  const plan = teachingPlan(bd);
  const step = plan.steps.find((s) => s.kind === "upToSpeed");
  const made = exerciseFor("x", bd, plan, step, 60);
  const fired = new Set();
  const perfect = run(made, "playThrough", (s, i, now) => {
    const due = s.dueOf(i);
    if (due === null || fired.has(i) || now < due) return null;
    fired.add(i);
    return note(s.steps[i].midi, due + 20);
  });
  check(perfect.finished && wasClean(made, perfect.judged, perfect.skippedSteps), "play along, every note on time: a clean run");
  const fired2 = new Set();
  const slip = run(made, "playThrough", (s, i, now) => {
    const due = s.dueOf(i);
    if (due === null || fired2.has(i) || now < due) return null;
    fired2.add(i);
    return note(s.steps[i].midi + (i === 2 ? 1 : 0), due + 20);
  });
  check(!wasClean(made, slip.judged, slip.skippedSteps), "one wrong note: not clean");
  const waiting = run(made, "loop", (s, i, now) => (now > 3000 && now % 400 === 0 ? note(s.steps[i].midi, now) : null));
  check(waiting.finished && wasClean(made, waiting.judged, waiting.skippedSteps), "wait for me, every note right: clean");
  const skipped = new NoteSession(made.exercise, "loop", 0);
  skipped.skip(10);
  check(!wasClean(made, skipped.judged, skipped.skippedSteps), "a skipped note: not clean");
}
{
  // A hammer-on the detector never hears is let off; a picked note it never hears is not.
  const made = { exercise: { id: "x", tempo: 60, steps: [{ string: 1, fret: 5, midi: 69, beat: 0 }, { string: 1, fret: 7, midi: 71, beat: 1 }] }, legato: new Set([1]) };
  const clean = { verdict: { state: "clean", counts: true } };
  const missed = { verdict: { state: "notCaught", counts: false } };
  check(wasClean(made, [{ index: 0, ...clean }, { index: 1, ...missed }], []), "an unheard hammer-on does not spoil a run");
  check(!wasClean({ ...made, legato: new Set() }, [{ index: 0, ...clean }, { index: 1, ...missed }], []), "an unheard picked note does");
}

// --- Progress -------------------------------------------------------------------------

{
  const bd = breakDown(ode);
  const plan = teachingPlan(bd);
  let record = newRecord(ode, "", 0);
  const at = (kind) => plan.steps.find((s) => s.kind === kind);
  check(sectionMastery(bd, record.progress, 0) === "new" && chunkMastery(undefined) === "new", "a new song is new");

  const meet = at("meet");
  record.progress.step = meet.index;
  let out = recordRun(record, plan, meet, false, false, true);
  check(out.result.kind === "next" && out.record.progress.step === meet.index + 1, "meet the notes: done once played through");

  const learn = at("learn");
  record = { ...out.record, progress: { ...out.record.progress, step: learn.index } };
  out = recordRun(record, plan, learn, false, true, true);
  check(out.result.kind === "again" && out.result.clean === 1, "slowly, wait for me: clean once → once more");
  out = recordRun(out.record, plan, learn, false, true, true);
  check(out.result.kind === "next" && out.record.progress.step === learn.index + 1 && out.record.progress.tempo === null, "slowly, wait for me: clean twice → next step");
  check(chunkMastery(out.record.progress.chunks[learn.chunks[0]]) === "clean", "its chunk is now clean");

  const up = at("upToSpeed");
  record = out.record;
  const trace = [];
  for (const clean of [true, true, true, true, false, false, false, true, true]) {
    out = recordRun(record, plan, up, true, clean, true);
    record = out.record;
    trace.push(`${clean ? "c" : "x"}${out.result.kind === "faster" ? "+" : out.result.kind === "slower" ? "-" : ""}${tempoFor(record.progress, up).percent}`);
  }
  check(trace.join(" ") === "c60 c+70 c70 c+80 x80 x80 x-70 c70 c+80", "play along: the tempo rule, run by run", trace.join(" "));
  const wait = recordRun(record, plan, up, false, true, true);
  check(wait.result.kind === "playAlong" && tempoFor(wait.record.progress, up).percent === 80, "up to speed, wait for me: tempo stays, says play along");

  let full = { ...record, progress: { ...record.progress, tempo: { percent: 100, clean: 0, failed: 0 } } };
  full = recordRun(full, plan, up, true, true, true).record;
  const done = recordRun(full, plan, up, true, true, true);
  check(done.result.kind === "next" && chunkMastery(done.record.progress.chunks[up.chunks[0]]) === "mastered", "clean twice at 100%: done, chunk mastered");

  const last = plan.steps.at(-1);
  const end = recordRun({ ...record, progress: { step: last.index, tempo: { percent: 100, clean: 1, failed: 0 }, chunks: record.progress.chunks } }, plan, last, true, true, true);
  check(end.result.kind === "song" && end.record.progress.step === last.index, "the whole song, clean at full speed: the song is learned");
  check(sectionMastery(bd, done.record.progress, 0) !== "new", "a section with practised chunks is no longer new", sectionMastery(bd, done.record.progress, 0));
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join("; ")}` : "\nall good");
process.exit(failures.length ? 1 : 0);
