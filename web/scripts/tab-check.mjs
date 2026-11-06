/**
 * Checks the plain-text tab reader without a browser.
 *
 *   npm run tab-check                       every fixture, pass/fail per file
 *   npm run tab-check -- --show 07-repeats  print what the reader made of one
 *
 * Each `test/tabs/NAME.txt` (a text tab) or `NAME.gp` / `NAME.musicxml` (a
 * score, read through alphaTab) has a `NAME.expected.json`. All fixtures are
 * original riffs or public-domain melodies: no real song tabs in the repo.
 * The .gp files are built by `node scripts/make-score-fixtures.mjs`.
 * Expected fields (all but `events` and `warnings` optional):
 *   events    ["5:0", "1:0 2:1 3:0", "3:7[hammer]", "2:7[bend+2,release]"]
 *             one string per event, notes "string:fret" high string first
 *   midi      ["45", "52 59 64"]  the same events as MIDI
 *   spacing   [null, 3, 3]           text tabs
 *   beats     ["0+1", "1+0.5"]      scores: start + length, in quarter notes
 *   timeSignature, source, tracks ["Bass: Bass", "Rhythm: Overdriven guitar"], track
 *   otherTracks {"0": ["4 strings"]}  warnings when another track is picked
 *   labels    ["Intro@0"]          name @ the event it comes before
 *   repeats   ["0-3x2"]            first-last event x times
 *   warnings  ["4-string", ...]    one substring per warning, in order, and no others
 *   title, artist, tuning, capo, tempo
 *
 * Then, on every fixture: each event points back at its note in the text
 * (scores: beats in order), and no prefix of the file makes the reader throw. Last, a few thousand
 * random scraps of tab-like text, which must never throw either.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importScore } from "../src/song/importers/score.ts";
import { parseTextTab } from "../src/song/textTab.ts";

const DIR = join(process.cwd(), "test", "tabs");
const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(36)} ${detail}`);
  if (!ok) failures.push(label);
}

const noteText = (note) => {
  const marks = [...note.techniques].sort().map((t) => (t === "bend" ? `bend+${note.bendSemitones}` : t));
  return `${note.string}:${note.fret}${marks.length ? `[${marks.join(",")}]` : ""}`;
};
const SCORE = /\.(gp|gp3|gp4|gp5|gpx|musicxml|xml|mxl)$/i;

/** The song in the expected-file vocabulary. */
function summary(song) {
  const score = song.source !== "text";
  return {
    title: song.title,
    ...(song.artist !== undefined ? { artist: song.artist } : {}),
    tuning: song.tuning,
    capo: song.capo,
    tempo: song.tempo,
    events: song.events.map((event) => event.notes.map(noteText).join(" ")),
    midi: song.events.map((event) => event.notes.map((note) => note.midi).join(" ")),
    ...(score
      ? { beats: song.events.map((event) => `${event.beat}+${event.durationBeats}`), timeSignature: song.timeSignature, source: song.source }
      : { spacing: song.events.map((event) => event.spacing) }),
    labels: song.labels.map((label) => `${label.name}@${label.beforeEvent}`),
    repeats: song.repeats.map((r) => `${r.fromEvent}-${r.toEvent}x${r.times}`),
    warnings: song.warnings,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** What differs between the expected file and what the reader made; empty when nothing. */
function differences(expected, actual) {
  const out = [];
  for (const key of ["title", "artist", "tuning", "capo", "tempo", "events", "midi", "spacing", "beats", "timeSignature", "source", "labels", "repeats", "tracks", "track"]) {
    if (!(key in expected) || same(expected[key], actual[key])) continue;
    if (Array.isArray(expected[key]) && Array.isArray(actual[key])) {
      const at = expected[key].findIndex((value, i) => !same(value, actual[key][i]));
      const i = at === -1 ? expected[key].length : at;
      out.push(`${key}[${i}]: expected ${JSON.stringify(expected[key][i])}, got ${JSON.stringify(actual[key][i])} (${expected[key].length} vs ${actual[key].length})`);
    } else out.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
  }
  const matches = (wanted, got) => wanted.length === got.length && wanted.every((part, i) => got[i].includes(part));
  const wanted = expected.warnings ?? [];
  if (!matches(wanted, actual.warnings)) out.push(`warnings: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual.warnings)}`);
  for (const [track, parts] of Object.entries(expected.otherTracks ?? {}))
    if (!matches(parts, actual.otherTracks?.[track] ?? [])) out.push(`track ${track}'s warnings: expected ${JSON.stringify(parts)}, got ${JSON.stringify(actual.otherTracks?.[track])}`);
  return out;
}

/** Every event's source position lands on the first character of one of its notes. */
function pointsBack(text, song) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  for (const event of song.events) {
    const char = lines[event.sourceLine - 1]?.[event.sourceColumn];
    if (!char || !/[0-9<[xX]/.test(char)) return `event ${event.index} points at ${JSON.stringify(char)} (line ${event.sourceLine}, column ${event.sourceColumn})`;
  }
  return null;
}

/** Scores: every event starts after the one before and lasts a while. */
function inOrder(song) {
  for (const [i, event] of song.events.entries()) {
    if (!(event.durationBeats > 0) || event.sourceLine < 1) return `event ${i} has no length or no bar`;
    if (i > 0 && !(event.beat > song.events[i - 1].beat)) return `event ${i} does not start after event ${i - 1}`;
  }
  return null;
}

/** The track list and the other tracks' warnings, in the expected-file vocabulary. */
function trackSummary(imported) {
  const otherTracks = {};
  for (const track of imported.tracks) if (track.index !== imported.track) otherTracks[track.index] = imported.songFor(track.index).warnings;
  return { tracks: imported.tracks.map((t) => `${t.name}: ${t.instrument}`), track: imported.track, otherTracks };
}

/** The shape every reading must have, whatever went in. */
function wellFormed(song) {
  if (!song || !Array.isArray(song.events) || !Array.isArray(song.warnings) || song.tuning.length !== 6) return "not a song";
  for (const [i, event] of song.events.entries()) {
    const rhythm = song.source === "text" ? event.beat === null && event.durationBeats === null : Number.isFinite(event.beat) && Number.isFinite(event.durationBeats);
    if (event.index !== i || !rhythm || event.notes.length === 0 || event.notes.length > 6) return `event ${i} malformed`;
    for (const note of event.notes) {
      if (!(note.string >= 1 && note.string <= 6) || !(note.fret >= 0 && note.fret <= 24) || !Number.isInteger(note.midi)) return `event ${i} has a bad note`;
    }
    if (new Set(event.notes.map((n) => n.string)).size !== event.notes.length) return `event ${i} has two notes on one string`;
  }
  return null;
}

async function read(file) {
  if (!SCORE.test(file)) return { song: parseTextTab(readFileSync(join(DIR, file), "utf8")), tracks: {} };
  const imported = await importScore(new Uint8Array(readFileSync(join(DIR, file))), file);
  return { song: imported.song, tracks: trackSummary(imported) };
}

const show = process.argv.indexOf("--show");
if (show !== -1) {
  const name = process.argv[show + 1];
  const file = readdirSync(DIR).find((f) => f === name || (f.startsWith(`${name}.`) && !f.endsWith(".expected.json")));
  const { song, tracks } = await read(file);
  console.log(JSON.stringify({ ...summary(song), ...tracks }, null, 2));
  process.exit(0);
}

// --- Fixtures ----------------------------------------------------------------

const names = readdirSync(DIR).filter((file) => file.endsWith(".txt") || SCORE.test(file)).sort();
for (const file of names) {
  const name = file.replace(/\.[^.]+$/, "");
  let expected;
  try {
    expected = JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), "utf8"));
  } catch (error) {
    check(false, name, `no readable ${name}.expected.json (${error.message})`);
    continue;
  }
  let song;
  let tracks;
  try {
    ({ song, tracks } = await read(file));
  } catch (error) {
    check(false, name, `threw: ${error.message}`);
    continue;
  }
  const problems = [...differences(expected, { ...summary(song), ...tracks })];
  const shape = wellFormed(song);
  if (shape) problems.push(shape);
  if (SCORE.test(file)) {
    const order = inOrder(song);
    if (order) problems.push(order);
    // A damaged download: the file cut short at eight places.
    const bytes = new Uint8Array(readFileSync(join(DIR, file)));
    for (let k = 0; k < 8; k++) {
      const cut = Math.floor((bytes.length * k) / 8);
      try {
        const partial = wellFormed((await importScore(bytes.subarray(0, cut), file)).song);
        if (partial) problems.push(`first ${cut} bytes: ${partial}`);
      } catch (error) {
        problems.push(`first ${cut} bytes threw: ${error.message}`);
      }
    }
  } else {
    const text = readFileSync(join(DIR, file), "utf8");
    const back = pointsBack(text, song);
    if (back) problems.push(back);
    const lines = text.split("\n");
    for (let k = 0; k < lines.length; k++) {
      try {
        const partial = wellFormed(parseTextTab(lines.slice(0, k).join("\n")));
        if (partial) problems.push(`first ${k} lines: ${partial}`);
      } catch (error) {
        problems.push(`first ${k} lines threw: ${error.message}`);
      }
    }
  }
  const counts = `${song.events.length} events, ${song.warnings.length} warning${song.warnings.length === 1 ? "" : "s"}`;
  check(problems.length === 0, name, problems.length ? problems.slice(0, 3).join("; ") : counts);
}
check(names.length >= 15, "at least 15 fixtures", `${names.length}`);
check(names.filter((file) => SCORE.test(file)).length >= 3, "at least 3 score fixtures", `${names.filter((file) => SCORE.test(file)).length}`);

// --- Never throws --------------------------------------------------------------

// A small seeded generator, so a failure here can be replayed.
let seed = 1504;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const SCRAPS = ["e|", "B|", "G|", "D|", "A|", "E|", "|", "-", "--", "0", "12", "7", "h", "p", "/", "\\", "b", "r", "~", "x", "<12>", "[5]", "*", "t", "PM---", "x2", "|:", ":|", " ", "\n", "Tuning: ", "Capo ", "drop d", "[Verse]", "Am G", "(", ")", "99", "b(", "\t", "\r\n"];
let thrown = 0;
let malformed = 0;
let firstFailure = "";
for (let k = 0; k < 3000; k++) {
  const parts = [];
  const length = 5 + Math.floor(random() * 120);
  for (let i = 0; i < length; i++) parts.push(SCRAPS[Math.floor(random() * SCRAPS.length)]);
  // Half the inputs get a real staff skeleton, so the deep paths run too.
  const text = random() < 0.5 ? "eBGDAE".split("").map((s) => `${s}|${parts.slice(0, 8).join("")}--`).join("\n") + "\n" + parts.join("") : parts.join("");
  try {
    const problem = wellFormed(parseTextTab(text));
    if (problem) {
      malformed++;
      firstFailure ||= `${problem}: ${JSON.stringify(text.slice(0, 120))}`;
    }
  } catch (error) {
    thrown++;
    firstFailure ||= `${error.message}: ${JSON.stringify(text.slice(0, 120))}`;
  }
}
check(thrown === 0 && malformed === 0, "3000 random scraps: never throws", thrown || malformed ? `${thrown} threw, ${malformed} malformed; ${firstFailure}` : "");

console.log(failures.length ? `\n${failures.length} failed` : `\nall passed`);
process.exit(failures.length ? 1 : 0);
