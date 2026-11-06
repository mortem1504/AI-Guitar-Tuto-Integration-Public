/**
 * Checks the finger guidance (src/song/guidance.ts) over every fixture and a
 * few hand-picked cases: open strings get finger 0, shifts are reported where
 * the hand moves, hammer-on, pull-off and slide arrows point at the right
 * note, chords show all their fingers and nothing after, never more than
 * three dots for a single note, and the fingertip corrections.
 *
 *   npm run guidance-check
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "../src/i18n/index.ts";
import { breakDown } from "../src/song/breakdown.ts";
import { guidanceAt, missOf, missText } from "../src/song/guidance.ts";
import { importScore } from "../src/song/importers/score.ts";
import { pressed } from "../src/song/fingering.ts";
import { parseTextTab } from "../src/song/textTab.ts";
import { edgeMark } from "../src/render/offPicture.ts";

const DIR = join(process.cwd(), "test", "tabs");
const SCORE = /\.(gp|musicxml)$/i;
const en = createTranslator("en");
const es = createTranslator("es");
const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(54)} ${detail}`);
  if (!ok) failures.push(label);
}
const text = (name) => parseTextTab(readFileSync(join(DIR, name), "utf8"));
const every = (bd) => bd.song.events.map((e) => e.index);

// --- Every fixture, every note ---------------------------------------------------------

for (const file of readdirSync(DIR).filter((f) => /\.(txt|gp|musicxml)$/i.test(f)).sort()) {
  const song = SCORE.test(file) ? (await importScore(new Uint8Array(readFileSync(join(DIR, file))), file)).song : parseTextTab(readFileSync(join(DIR, file), "utf8"));
  const bd = breakDown(song);
  const order = every(bd);
  const problems = [];
  order.forEach((index, column) => {
    const g = guidanceAt(bd, order, column, 2, en);
    const event = bd.song.events[index];
    const now = g.targets.filter((x) => x.role === "now");
    if (now.length !== event.notes.length) problems.push(`${index}: ${now.length} now for ${event.notes.length} notes`);
    if (event.notes.length === 1 && g.targets.length > 3) problems.push(`${index}: ${g.targets.length} dots`);
    if (event.notes.length > 1 && g.targets.some((x) => x.role !== "now")) problems.push(`${index}: a chord shows what comes after it`);
    now.forEach((x, k) => {
      const note = event.notes[k];
      if (!pressed(note) && x.finger !== 0) problems.push(`${index}: unpressed note given finger ${x.finger}`);
      if (pressed(note) && x.finger === 0) problems.push(`${index}: pressed note given no finger`);
    });
    if (g.handWindow.toFret - g.handWindow.fromFret !== 3) problems.push(`${index}: hand window ${g.handWindow.fromFret}-${g.handWindow.toFret}`);
    const fingering = bd.fingering.events[index];
    if (!fingering.stretch && now.some((x, k) => pressed(event.notes[k]) && (x.fret < g.handWindow.fromFret || x.fret > g.handWindow.toFret))) problems.push(`${index}: a fretted note outside the hand window`);
    const next = bd.fingering.events[order[column + 1]];
    const moves = next && next.position !== fingering.position && bd.song.events[order[column + 1]].notes.some(pressed);
    if (!!g.shift !== !!moves) problems.push(`${index}: shift ${JSON.stringify(g.shift)} but the hand ${moves ? "moves" : "stays"}`);
    if (!g.text || g.text.includes("{")) problems.push(`${index}: text "${g.text}"`);
  });
  check(problems.length === 0, `${file}: every note guided`, problems.slice(0, 2).join("; ") || `${order.length} notes`);
}

// --- Hand-picked expectations ----------------------------------------------------------

{
  const bd = breakDown(text("16-ode-to-joy.txt"));
  const order = every(bd);
  const g = guidanceAt(bd, order, 0, 2, en);
  check(g.targets[0].finger === 0 && g.targets[0].fret === 0, "Ode: the first note is an open string, finger 0");
  check(g.targets.map((x) => x.role).join() === "now,next,later", "now, next, later: three dots");
  check(guidanceAt(bd, order, 0, 0, en).targets.length === 1 && guidanceAt(bd, order, 0, 1, en).targets.length === 2, "next notes shown: 0 or 1 when asked");
  check(guidanceAt(bd, order, 0, 9, en).targets.length === 3, "never more than two ahead, whatever is asked");
  check(guidanceAt(bd, order, order.length - 1, 2, en).targets.length === 1, "the last note has nothing after it");
  check(guidanceAt(bd, order, order.length, 2, en) === null, "past the end: no guidance");
  check(/Open string 1/.test(g.text) && /suggested/.test(g.text), "the open string is said in words, and fingers are 'suggested'", g.text);
  check(guidanceAt(bd, order, 0, 2, es).text !== g.text && /sugerencia/.test(guidanceAt(bd, order, 0, 2, es).text), "and in Spanish", guidanceAt(bd, order, 0, 2, es).text);
}
{
  // 5h7p5 on G, then 7/9, 9\7, a vibrato on D 7~, 5s7, 7s5 (fixture 03).
  const bd = breakDown(text("03-techniques.txt"));
  const order = every(bd);
  const at = (c) => guidanceAt(bd, order, c, 2, en).targets[0];
  const say = (x) => `${x.technique ?? "-"}${x.techniqueTarget ? `→${x.techniqueTarget.string}/${x.techniqueTarget.fret}` : ""}`;
  check(say(at(0)) === "hammer→3/7", "5h7: an arrow from 5 to 7, hammer-on", say(at(0)));
  check(say(at(1)) === "pull→3/5", "7p5: an arrow from 7 back to 5, pull-off", say(at(1)));
  const slide = order.findIndex((i) => bd.song.events[i].notes[0].techniques.includes("slideUp"));
  check(say(at(slide - 1)) === `slideUp→3/${bd.song.events[order[slide]].notes[0].fret}`, "7/9: a straight slide arrow to 9", say(at(slide - 1)));
  const vib = order.findIndex((i) => bd.song.events[i].notes[0].techniques.includes("vibrato"));
  check(at(vib).technique === "vibrato" && !at(vib).techniqueTarget, "7~: vibrato drawn on the note itself");
  // A hot-spot drill repeats its two notes: the jump back is not a slide.
  const loop = [0, 1, 0, 1];
  check(guidanceAt(bd, loop, 1, 2, en).targets[0].technique === undefined, "a repeat jumping back draws no technique arrow");
}
{
  const bd = breakDown(text("17-bends.txt"));
  const order = every(bd);
  const bend = order.findIndex((i) => bd.song.events[i].notes[0].techniques.includes("bend"));
  const g = guidanceAt(bd, order, bend, 2, en);
  check(g.targets[0].technique === "bend" && g.targets[0].bendSemitones > 0, "a bend carries how far", `${g.targets[0].bendSemitones} semitones`);
}
{
  // A melody that leaves first position: the shift is reported on the note before it, with where to.
  const song = parseTextTab("e|--3--5--8--10--12--|\nB|------------------|\nG|------------------|\nD|------------------|\nA|------------------|\nE|------------------|\n");
  const bd = breakDown(song);
  const order = every(bd);
  const shifts = order.map((_, c) => guidanceAt(bd, order, c, 2, en).shift).filter(Boolean);
  check(shifts.length === bd.fingering.shifts && shifts.length > 0, "shifts reported where the hand moves", shifts.map((s) => `${s.from}→${s.to}`).join(" "));
  const before = order.findIndex((_, c) => guidanceAt(bd, order, c, 2, en).shift);
  check(/move your hand to fret/.test(guidanceAt(bd, order, before, 2, en).text), "and said in words", guidanceAt(bd, order, before, 2, en).text);
}
{
  const bd = breakDown(text("04-chords.txt"));
  const order = every(bd);
  const chord = order.findIndex((i) => bd.song.events[i].notes.length > 2);
  const g = guidanceAt(bd, order, chord, 2, en);
  check(g.targets.length === bd.song.events[order[chord]].notes.length && g.targets.every((x) => x.role === "now"), "a chord: all its fingers, as now", `${g.targets.length} dots`);
  check(/listen-only/.test(g.text), "and it says listen-only", g.text);
}

// --- Fingertip corrections --------------------------------------------------------------

{
  const slack = { string: 0.38, fret: 0.3 };
  const target = { string: 3, fret: 5 };
  check(missOf(target, { string: 3.1, wire: 4.6 }, slack) === null, "a tip inside the box, on the string: no correction");
  const far = missOf(target, { string: 3, wire: 6.4 }, slack);
  check(far?.kind === "fret" && far.far && far.by === 1, "a fret too far", missText(en, far));
  const short = missOf(target, { string: 3, wire: 2.5 }, slack);
  check(short?.kind === "fret" && !short.far && short.by === 2, "two frets short", missText(en, short));
  const low = missOf(target, { string: 4.05, wire: 4.5 }, slack);
  check(low?.kind === "string" && low.thicker && low.by === 1, "one string too low (thicker)", missText(en, low));
  const both = missOf(target, { string: 1, wire: 7.5 }, slack);
  check(both?.kind === "fret", "both out: the fret is said first, as the judge does");
}

// A dot off the picture (nut off camera, a chord on fret 2) is drawn on the
// nearest edge, at its own height, pointing out; a dot on the picture is not.
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check(edgeMark({ x: 600, y: 300 }, 1280, 720, 30) === null, "a dot on the picture stays where it is");
  check(edgeMark({ x: 1280, y: 720 }, 1280, 720, 30) === null, "a dot exactly on the corner is on the picture");
  const right = edgeMark({ x: 1400, y: 300 }, 1280, 720, 30);
  check(!!right && near(right.at.x, 1250) && near(right.at.y, 300) && near(right.angle, 0), "off the right: on the right edge, same height, pointing right", JSON.stringify(right));
  const corner = edgeMark({ x: -50, y: 900 }, 1280, 720, 30);
  check(!!corner && near(corner.at.x, 30) && near(corner.at.y, 690) && corner.angle > Math.PI / 2 && corner.angle < Math.PI, "off a corner: in that corner, pointing out of it", JSON.stringify(corner));
  check(edgeMark({ x: Number.NaN, y: 0 }, 1280, 720, 30) === null, "not a point: nothing drawn");
  // A neck rising out of the right edge: the dot goes where its string
  // leaves the picture, not level with the off-picture spot (on the wall).
  const string = edgeMark({ x: 1480, y: 100 }, 1280, 720, 30, { x: 880, y: 400 });
  check(!!string && near(string.at.x, 1250) && near(string.at.y, 400 - 300 * (370 / 600)) && near(string.angle, Math.atan2(-300, 600)), "along its string: where the string leaves the picture", JSON.stringify(string));
  const outside = edgeMark({ x: 1480, y: 100 }, 1280, 720, 30, { x: 1300, y: 400 });
  check(!!outside && near(outside.at.x, 1250) && near(outside.at.y, 100), "its string off the picture too: the nearest edge", JSON.stringify(outside));
  const tiny = edgeMark({ x: 500, y: 10 }, 40, 20, 30);
  check(!!tiny && tiny.at.x === 20 && tiny.at.y === 10, "a canvas smaller than the inset: the middle, not outside it", JSON.stringify(tiny));
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join("; ")}` : "\nall good");
process.exit(failures.length ? 1 : 0);
