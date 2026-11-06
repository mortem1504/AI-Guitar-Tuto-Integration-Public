/**
 * The browser's detector on the lab's recordings, next to the lab's numbers.
 *
 *   npm run audio-check                                # the dataset of lab/results/latest.json
 *   npm run audio-check -- --data ../lab/data/notes
 *
 * `lab/evaluate.py` measures a Python copy of `NoteDetector`. This runs the
 * TypeScript class itself, the one the AudioWorklet runs, over the same WAVs
 * with the same parameter variants, and puts the two side by side. If they
 * differ by more than 2 points of accuracy on any variant, the lab's numbers
 * are not the browser's numbers and nothing should be exported from them:
 * it fails.
 *
 * Clip by clip, the two should agree exactly; disagreements are listed.
 * Variants the browser cannot run (lab-only parameters, the pYIN baseline)
 * are skipped.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NoteDetector } from "../src/audio/dsp/detector.ts";
import { PARAMS } from "../src/audio/params.ts";
import { readWav } from "./lib/wav.mjs";

const LAB = resolve("../lab");
const LATEST = resolve(LAB, "results/latest.json");
/** The build brief's limit for TS and Python disagreeing, in points of accuracy. */
const MAX_DIFFERENCE = 2;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** RFC 4180 enough for labels.csv: a device name may contain a comma. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(header.map((key, i) => [key, r[i] ?? ""])));
}

/** The same classes as lab/src/audio/evaluation.py `classify`. */
function classify(expected, detected) {
  if (detected === null) return "unpitched";
  const diff = Math.abs(detected - expected);
  if (diff === 0) return "correct";
  if ([12, 24, 36].includes(diff)) return "octave";
  if ([19, 28].includes(diff)) return "harmonic";
  if (diff === 7) return "fifth";
  if (diff === 1) return "semitone";
  return "other";
}

/** numpy's default (linear) percentile, so latencies compare like for like. */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (p / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function firstEvent(samples, sampleRate, params) {
  let first = null;
  const detector = new NoteDetector(sampleRate, params, (m) => {
    if (!first && m.type !== "level") first = m;
  });
  for (let i = 0; i < samples.length && !first; i += 128) detector.push(samples.subarray(i, Math.min(samples.length, i + 128)));
  return first;
}

// --- Inputs ---------------------------------------------------------------

const latest = existsSync(LATEST) ? JSON.parse(readFileSync(LATEST, "utf8")) : null;
const data = resolve(argument("--data") ?? (latest ? resolve(LAB, latest.dataset) : resolve(LAB, "data/notes")));
const labelsPath = resolve(data, "labels.csv");
if (!existsSync(labelsPath)) {
  console.log(`No labels.csv in ${data}. Record with lab/record_dataset.py, or make lab/data/synthetic.`);
  process.exit(1);
}
const labels = parseCsv(readFileSync(labelsPath, "utf8"));
const python = latest && resolve(LAB, latest.dataset) === data ? latest : null;

const failures = [];
if (python) {
  const changed = Object.keys(PARAMS).filter((key) => JSON.stringify(PARAMS[key]) !== JSON.stringify(python.params[key]));
  if (changed.length) {
    console.log(`FAIL params.ts changed since lab run ${python.run_id}: ${changed.join(", ")}. Rerun evaluate.py.`);
    process.exit(1);
  }
}

const variants = python
  ? Object.entries(python.variants).filter(([, v]) => v.exportable).map(([name, v]) => [name, v.overrides])
  : [["web", {}]];

const pythonClips = new Map();
if (python && existsSync(python.per_clip)) {
  for (const row of parseCsv(readFileSync(python.per_clip, "utf8"))) pythonClips.set(row.file, row);
}

// --- Run ------------------------------------------------------------------

console.log(`TS NoteDetector on ${labels.length} clips from ${data}`);
console.log(python ? `against lab run ${python.run_id}${python.synthetic ? " (SYNTHETIC)" : ""}\n` : "no lab run for this dataset: TS numbers only\n");

const audio = labels.map((label) => readWav(readFileSync(resolve(data, label.file))));

console.log(
  `${"variant".padEnd(18)}${"Python".padStart(9)}${"TS".padStart(9)}${"diff".padStart(8)}` +
    `${"octave py/ts".padStart(14)}${"p50 ms py/ts".padStart(15)}${"same answer".padStart(14)}`,
);
for (const [name, overrides] of variants) {
  const params = { ...PARAMS, ...overrides };
  let correct = 0;
  let octave = 0;
  let agree = 0;
  const latencies = [];
  const disagreements = [];
  labels.forEach((label, i) => {
    const { samples, sampleRate } = audio[i];
    const event = firstEvent(samples, sampleRate, params);
    const expected = Number(label.midi);
    const midi = event?.type === "note" ? event.midi : null;
    const outcome = event ? classify(expected, midi) : "missed";
    if (outcome === "correct") correct++;
    if (outcome === "octave") octave++;
    if (event) latencies.push((event.detectTime - event.onsetTime) * 1000);

    const row = pythonClips.get(label.file);
    if (row) {
      const theirs = `${row[`${name}_outcome`]} ${row[`${name}_midi`]}`;
      const ours = `${outcome} ${midi ?? ""}`;
      if (theirs === ours) agree++;
      else disagreements.push(`${label.file}: Python ${theirs.trim()}, TS ${ours.trim()}`);
    }
  });

  const accuracy = (100 * correct) / labels.length;
  const p50 = percentile(latencies, 50);
  const theirs = python?.variants[name];
  const line = (a, b, f) => `${a === undefined ? "—" : f(a)}/${f(b)}`;
  if (theirs) {
    const difference = accuracy - 100 * theirs.accuracy;
    const ok = Math.abs(difference) <= MAX_DIFFERENCE;
    if (!ok) failures.push(name);
    console.log(
      `${(ok ? "" : "FAIL ") + name}`.padEnd(18) +
        `${(100 * theirs.accuracy).toFixed(1)}%`.padStart(9) +
        `${accuracy.toFixed(1)}%`.padStart(9) +
        `${difference >= 0 ? "+" : ""}${difference.toFixed(1)}`.padStart(8) +
        line(theirs.counts.octave, octave, String).padStart(14) +
        line(theirs.latency_p50_ms ?? undefined, p50 ?? NaN, (v) => v.toFixed(0)).padStart(15) +
        (pythonClips.size ? `${agree}/${labels.length}` : "—").padStart(14),
    );
  } else {
    console.log(`${name.padEnd(18)}${"—".padStart(9)}${`${accuracy.toFixed(1)}%`.padStart(9)}${"".padStart(8)}${String(octave).padStart(14)}${(p50?.toFixed(0) ?? "—").padStart(15)}`);
  }
  for (const d of disagreements.slice(0, 5)) console.log(`    ${d}`);
  if (disagreements.length > 5) console.log(`    ... and ${disagreements.length - 5} more`);
}

if (!python) {
  console.log(`\nRun lab/evaluate.py --data ${data} first to compare.`);
  process.exit(1);
}
console.log(failures.length ? `\nFAIL: TS and Python differ by more than ${MAX_DIFFERENCE} points on ${failures.join(", ")}` : `\nall good: TS within ${MAX_DIFFERENCE} points of Python on every variant`);
process.exit(failures.length ? 1 : 0);
