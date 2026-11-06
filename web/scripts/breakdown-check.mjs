/**
 * Checks the automatic breakdown, the suggested fingering and the teaching
 * plan, over every fixture in test/tabs/ and a few made-up songs.
 *
 *   npm run breakdown-check                        all checks
 *   npm run breakdown-check -- --show 16-ode-to-joy  print one song's breakdown and plan
 *
 * On every fixture: sections and chunks cover each note exactly once, chunks
 * hold 4-12 notes (fewer only when the whole section is smaller), 1-3 hot
 * spots per section, fingers follow fret - position + 1, the plan covers the
 * whole song, and the same input gives the same output. Then specific
 * expectations a guitarist would check by eye, the tempo rule, and the time
 * for a 300-note tab.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { breakDown, HOT_SPOT_MIN, MAX_CHUNK, MIN_CHUNK } from "../src/song/breakdown.ts";
import { pressed } from "../src/song/fingering.ts";
import { importScore } from "../src/song/importers/score.ts";
import { afterRun, bpmOf, startTempo, teachingPlan } from "../src/song/plan.ts";
import { parseTextTab } from "../src/song/textTab.ts";

const DIR = join(process.cwd(), "test", "tabs");
const SCORE = /\.(gp|gp3|gp4|gp5|gpx|musicxml|xml|mxl)$/i;
const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(44)} ${detail}`);
  if (!ok) failures.push(label);
}

async function songOf(file) {
  return SCORE.test(file) ? (await importScore(new Uint8Array(readFileSync(join(DIR, file))), file)).song : parseTextTab(readFileSync(join(DIR, file), "utf8"));
}

/** Everything that must hold for any song; the list of what does not. */
function invariants(song, breakdown, plan) {
  const problems = [];
  const n = song.events.length;
  const { sections } = breakdown.song;
  // Sections: contiguous, in order, covering every event.
  let next = 0;
  for (const section of sections) {
    if (section.firstEvent !== next || section.lastEvent < section.firstEvent) problems.push(`section "${section.name}" starts at ${section.firstEvent}, expected ${next}`);
    next = section.lastEvent + 1;
  }
  if (next !== n) problems.push(`sections end at ${next}, the song has ${n} notes`);
  // Chunks: each event in exactly one, inside its section, 4-12 unless the section is smaller.
  const owner = new Array(n).fill(0);
  for (const chunk of breakdown.chunks) {
    const section = sections[chunk.section];
    const size = chunk.lastEvent - chunk.firstEvent + 1;
    const sectionSize = section.lastEvent - section.firstEvent + 1;
    if (chunk.firstEvent < section.firstEvent || chunk.lastEvent > section.lastEvent) problems.push(`chunk ${chunk.index} leaves its section`);
    if (size > MAX_CHUNK || (size < MIN_CHUNK && size !== sectionSize)) problems.push(`chunk ${chunk.index} has ${size} notes (section ${sectionSize})`);
    if (!(Number.isInteger(chunk.difficulty.score) && chunk.difficulty.score >= 0 && chunk.difficulty.score <= 100)) problems.push(`chunk ${chunk.index} difficulty ${chunk.difficulty.score}`);
    if (chunk.difficulty.factors.some((f) => !(f.score >= 0 && f.score <= 100) || !f.text)) problems.push(`chunk ${chunk.index} has a bad factor`);
    for (let i = chunk.firstEvent; i <= chunk.lastEvent; i++) owner[i]++;
  }
  const wrong = owner.findIndex((count) => count !== 1);
  if (wrong !== -1) problems.push(`note ${wrong} is in ${owner[wrong]} chunks`);
  // Hot spots: 0-3 per section, inside it, neighbours.
  sections.forEach((section, s) => {
    const spots = breakdown.hotSpots.filter((h) => h.section === s);
    if (spots.length > 3) problems.push(`section ${s} has ${spots.length} hot spots`);
    if (spots.some((h) => h.toEvent !== h.fromEvent + 1 || h.fromEvent < section.firstEvent || h.toEvent > section.lastEvent)) problems.push(`section ${s} has a hot spot outside it`);
    if (spots.some((h) => h.cost < HOT_SPOT_MIN || h.reasons.length === 0)) problems.push(`section ${s} has a hot spot that is not hard`);
  });
  // Fingering: unpressed notes 0, pressed ones fret - position + 1 (unless a stretch), always "suggested".
  if (breakdown.fingering.label !== "suggested") problems.push("fingering is not labelled suggested");
  song.events.forEach((event, i) => {
    const f = breakdown.fingering.events[i];
    event.notes.forEach((note, k) => {
      const open = !pressed(note);
      const want = open ? 0 : note.fret - f.position + 1;
      if (open ? f.fingers[k] !== 0 : f.stretch ? !(f.fingers[k] >= 1 && f.fingers[k] <= 4) : f.fingers[k] !== want)
        problems.push(`note ${i} (${note.string}:${note.fret}) finger ${f.fingers[k]} at position ${f.position}`);
    });
  });
  // Plan: learning steps cover every note; the last step covers the whole song.
  const learned = new Array(n).fill(false);
  for (const step of plan.steps) if (step.kind === "learn") for (let i = step.fromEvent; i <= step.toEvent; i++) learned[i] = true;
  if (learned.some((x) => !x)) problems.push(`note ${learned.indexOf(false)} is never taught`);
  const last = plan.steps[plan.steps.length - 1];
  if (n > 0 && (!last || last.fromEvent !== 0 || last.toEvent !== n - 1 || last.goalPercent !== 100)) problems.push(`the last step "${last?.title}" is not the whole song at full speed`);
  if (n > 0 && plan.steps[0].kind !== "meet") problems.push("the plan does not start by meeting the notes");
  if (plan.steps.some((s, i) => s.index !== i)) problems.push("plan steps are misnumbered");
  return problems;
}

const show = process.argv.indexOf("--show");
if (show !== -1) {
  const name = process.argv[show + 1];
  const file = readdirSync(DIR).find((f) => f === name || (f.startsWith(`${name}.`) && !f.endsWith(".expected.json")));
  const song = await songOf(file);
  const breakdown = breakDown(song);
  const plan = teachingPlan(breakdown);
  const noteText = (i) => song.events[i].notes.map((n, k) => `${n.string}:${n.fret}/f${breakdown.fingering.events[i].fingers[k]}`).join(" ");
  for (const [s, section] of breakdown.song.sections.entries()) {
    console.log(`[${section.name}] notes ${section.firstEvent}-${section.lastEvent}`);
    for (const chunk of breakdown.chunks.filter((c) => c.section === s))
      console.log(`  chunk ${chunk.index}: ${chunk.firstEvent}-${chunk.lastEvent}  difficulty ${chunk.difficulty.score}  (${chunk.difficulty.factors.slice(0, 3).map((f) => `${f.text} ${f.score}`).join("; ")})`);
    for (const spot of breakdown.hotSpots.filter((h) => h.section === s)) console.log(`  hot spot ${spot.fromEvent}->${spot.toEvent} cost ${spot.cost}: ${spot.reasons.join(", ")}`);
  }
  console.log("fingering:", song.events.map((_, i) => `${breakdown.fingering.events[i].shift ? "| " : ""}${noteText(i)}@${breakdown.fingering.events[i].position}`).join("  "));
  console.log(`plan (${plan.tempoKnown ? "" : "assumed "}${plan.targetTempo} BPM):`);
  for (const step of plan.steps) console.log(`  ${String(step.index + 1).padStart(2)}. ${step.title}  [${step.fromEvent}-${step.toEvent}]${step.startPercent ? ` ${step.startPercent}%->${step.goalPercent}%` : ""}`);
  process.exit(0);
}

// --- Every fixture -------------------------------------------------------------------

const files = readdirSync(DIR).filter((f) => f.endsWith(".txt") || SCORE.test(f)).sort();
const results = {};
for (const file of files) {
  const name = file.replace(/\.[^.]+$/, "");
  const song = await songOf(file);
  let breakdown;
  let plan;
  try {
    breakdown = breakDown(song);
    plan = teachingPlan(breakdown);
  } catch (error) {
    check(false, name, `threw: ${error.message}`);
    continue;
  }
  const problems = invariants(song, breakdown, plan);
  // Same input, same output: once more from a fresh reading of the file.
  const again = breakDown(await songOf(file));
  if (JSON.stringify(again) !== JSON.stringify(breakdown) || JSON.stringify(teachingPlan(again)) !== JSON.stringify(plan)) problems.push("a second run differs");
  results[name] = { song, breakdown, plan };
  const scores = breakdown.chunks.map((c) => c.difficulty.score).join("/");
  check(problems.length === 0, name, problems.length ? problems.slice(0, 3).join("; ") : `${breakdown.song.sections.length} sections, ${breakdown.chunks.length} chunks (${scores}), ${plan.steps.length} steps`);
}

// --- What a guitarist would check -------------------------------------------------------

const fingersOf = (name) => results[name].breakdown.fingering.events.map((f) => f.fingers.join("+")).join(" ");
const maxScore = (name) => Math.max(...results[name].breakdown.chunks.map((c) => c.difficulty.score));

// Ode to Joy in first position: E F G on the e string with 0 1 3, D C on the B string with 3 1.
check(fingersOf("16-ode-to-joy") === "0 0 1 3 3 1 0 3 1 1 3 0 0 3 3", "Ode to Joy: first-position fingers", fingersOf("16-ode-to-joy"));
check(results["16-ode-to-joy"].breakdown.fingering.shifts === 0, "Ode to Joy: no hand shifts");
// 5h7p5 at the 5th position: index, ring, index.
check(fingersOf("03-techniques").startsWith("1 3 1"), "5h7p5 is fingered 1 3 1", fingersOf("03-techniques"));
// The 10-12-15 climb needs the hand to move; the open riff never does.
check(results["02-two-digit-frets"].breakdown.fingering.shifts >= 1, "the 10-12-15 climb shifts the hand", `${results["02-two-digit-frets"].breakdown.fingering.shifts} shifts`);
check(results["01-clean-riff"].breakdown.fingering.shifts === 0, "the open-position riff never shifts");
// Difficulty orders the fixtures the way a teacher would.
check(maxScore("16-ode-to-joy") < maxScore("02-two-digit-frets"), "Ode to Joy is easier than the high climb", `${maxScore("16-ode-to-joy")} < ${maxScore("02-two-digit-frets")}`);
check(maxScore("01-clean-riff") < maxScore("17-bends"), "the open riff is easier than the bend drill", `${maxScore("01-clean-riff")} < ${maxScore("17-bends")}`);
// Labels name the sections; unlabelled scores fall back to phrases.
check(results["08-lyrics-and-labels"].breakdown.song.sections.map((s) => s.name).join("|") === "Intro|Verse 1|Chorus", "labels become sections", results["08-lyrics-and-labels"].breakdown.song.sections.map((s) => s.name).join("|"));
check(results["20-waltz-steps"].breakdown.song.sections.map((s) => s.name).join("|") === "Intro|Theme", "score section markers become sections");
// Speed counts only when there is rhythm.
check(results["20-waltz-steps"].breakdown.chunks.every((c) => c.difficulty.factors.some((f) => f.key === "speed")), "scores are scored on speed");
check(results["16-ode-to-joy"].breakdown.chunks.every((c) => !c.difficulty.factors.some((f) => f.key === "speed")), "text tabs are not scored on speed");
// Hot spots only where something is hard.
const spots = (name) => results[name].breakdown.hotSpots.length;
check(spots("16-ode-to-joy") === 0 && spots("01-clean-riff") === 0, "easy tunes have no hot spots");
check(spots("17-bends") >= 1 && spots("02-two-digit-frets") >= 1, "the bend drill and the high climb have some", `${spots("17-bends")}, ${spots("02-two-digit-frets")}`);
// Harmonics and taps do not move the fretting hand.
const bells = results["15-harmonics-dead-pm-tap"].breakdown.fingering.events;
check(bells[0].fingers.join("+") === "0+0" && bells[7].fingers[0] === 0, "harmonics and taps get finger 0", `${bells[0].fingers.join("+")}, ${bells[7].fingers[0]}`);
// Chords are listen-only.
check(results["04-chords"].breakdown.chunks.reduce((n, c) => n + c.listenOnly, 0) === 4, "four chords, four listen-only notes");

// --- Made-up songs ------------------------------------------------------------------------

// One long staff of 40 notes with a gap after every 10th: chunks cut at the gaps.
const staff = (cells) => ["e", "B", "G", "D", "A", "E"].map((s, k) => `${s}|${cells.map((c) => (c[0] === k + 1 ? String(c[1]) : "-".repeat(String(c[1]).length)).padEnd(c[2], "-")).join("")}|`).join("\n");
const cells = [];
for (let i = 0; i < 40; i++) cells.push([3 - (i % 3), [0, 2, 3, 5][i % 4], i % 10 === 9 ? 8 : 3]);
const long = breakDown(parseTextTab(`Long Run (made up)\n\n${staff(cells)}`));
const sizes = long.chunks.map((c) => c.lastEvent - c.firstEvent + 1);
check(sizes.every((s) => s >= MIN_CHUNK && s <= MAX_CHUNK), "40 notes on one staff: chunks of 4-12", sizes.join(" "));
check(long.chunks.slice(0, -1).every((c) => (c.lastEvent + 1) % 10 === 0), "...cut at the gaps", long.chunks.map((c) => c.lastEvent).join(" "));
// A three-note tab is one tiny chunk, still a complete plan.
const tiny = breakDown(parseTextTab("e|--0--1--3--|\nB|-----------|\nG|-----------|\nD|-----------|\nA|-----------|\nE|-----------|"));
const tinyPlan = teachingPlan(tiny);
check(tiny.chunks.length === 1 && invariants(tiny.song, tiny, tinyPlan).length === 0, "three notes: one chunk, a complete plan", tinyPlan.steps.map((s) => s.kind).join(" "));
// An empty song breaks down to nothing, without throwing.
const empty = breakDown(parseTextTab(""));
check(empty.chunks.length === 0 && teachingPlan(empty).steps.length === 0, "an empty song has no chunks and no steps");

// --- The tempo rule -----------------------------------------------------------------------

const step = { startPercent: 60, goalPercent: 100 };
let state = startTempo(step);
const trace = [];
for (const clean of [true, true, true, false, false, false, true, true]) {
  const out = afterRun(step, state, clean);
  state = out.state;
  trace.push(`${clean ? "c" : "x"}${out.change === "up" ? "+" : out.change === "down" ? "-" : ""}${state.percent}`);
}
check(trace.join(" ") === "c60 c+70 c70 x70 x70 x-60 c60 c+70", "2 clean up 10, 3 failed down 10", trace.join(" "));
let top = { percent: 100, clean: 0, failed: 0 };
let outcome;
for (let k = 0; k < 2; k++) ({ state: top, ...outcome } = afterRun(step, top, true));
check(top.percent === 100 && outcome.done, "clean twice at 100%: done, never above 100%");
let floor = { percent: 40, clean: 0, failed: 0 };
for (let k = 0; k < 6; k++) floor = afterRun(step, floor, false).state;
check(floor.percent === 40, "never below 40%");
const learn = { startPercent: 60, goalPercent: 60 };
check(afterRun(learn, afterRun(learn, startTempo(learn), true).state, true).done, "a slow step is done after 2 clean runs at 60%");
check(bpmOf(teachingPlan(results["16-ode-to-joy"].breakdown), 60) === 60, "no tempo in the tab: 60% is 60 BPM");
check(bpmOf(teachingPlan(results["20-waltz-steps"].breakdown), 60) === 50, "84 BPM song: 60% is 50 BPM");

// --- Speed --------------------------------------------------------------------------------

// 300 notes on 10 staves, the brief's budget: under 100 ms to break down.
const staves = [];
for (let s = 0; s < 10; s++) {
  const row = [];
  for (let i = 0; i < 30; i++) row.push([1 + ((i + s) % 6), (i * 7 + s * 3) % 15, 3]);
  staves.push(staff(row));
}
const big = parseTextTab(`Big Tab (made up)\n\n${staves.join("\n\n")}`);
const t0 = performance.now();
const bigBreakdown = breakDown(big);
teachingPlan(bigBreakdown);
const ms = performance.now() - t0;
check(big.events.length === 300 && ms < 100, "300 notes broken down in under 100 ms", `${big.events.length} notes, ${ms.toFixed(1)} ms, ${bigBreakdown.chunks.length} chunks`);
const average = Object.values(results).flatMap((r) => r.breakdown.chunks.map((c) => c.lastEvent - c.firstEvent + 1));
console.log(`\naverage chunk over the fixtures: ${(average.reduce((a, b) => a + b, 0) / average.length).toFixed(1)} notes (${average.length} chunks)`);

console.log(failures.length ? `\n${failures.length} failed` : "\nall good");
process.exit(failures.length ? 1 : 0);
