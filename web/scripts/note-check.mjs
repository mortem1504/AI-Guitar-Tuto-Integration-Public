/**
 * Measures the live note detector without a guitar.
 *
 *   npm run note-check
 *
 * Runs `NoteDetector` — the exact class the AudioWorklet runs — over
 * synthesised plucks: every string, frets 0-12, two takes each, in three
 * rooms:
 *
 *   clean    the pluck alone, over a faint noise floor
 *   noisy    white noise 20 dB below the note
 *   laptop   high-passed at 250 Hz, the way a laptop microphone hears a
 *            guitar: the thick strings lose most of their fundamental, which is
 *            what produces octave errors in real life
 *
 * A synthesised pluck is a fair test of the arithmetic and a poor stand-in for
 * a real guitar in a real room. Phase 2 replaces this with recordings from the
 * lab; until then, these numbers are what `src/audio/params.ts` cites.
 *
 * Also checked: noise alone fires nothing, a repeated note is heard twice, the
 * 24th fret is reachable, a 44.1 kHz input works, and how long one pitch
 * detection takes (it runs on the audio thread, which has ~2.7 ms per call).
 */

import { NoteDetector } from "../src/audio/dsp/detector.ts";
import { createPitchDetector } from "../src/audio/dsp/pitch.ts";
import { PARAMS } from "../src/audio/params.ts";
import { NoteEvents } from "../src/audio/noteEvents.ts";
import { SYNTH_SEQUENCE, synthSource } from "../src/audio/synthSource.ts";
import { addNoise, clip, OPEN, pluck, rng } from "./lib/synth.mjs";

function run(samples, sampleRate, params = PARAMS) {
  const messages = [];
  const detector = new NoteDetector(sampleRate, params, (m) => m.type !== "level" && messages.push(m));
  for (let i = 0; i < samples.length; i += 128) detector.push(samples.subarray(i, Math.min(samples.length, i + 128)));
  return messages;
}

function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const failures = [];
function check(ok, label, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(44)} ${detail}`);
  if (!ok) failures.push(label);
}

// --- Accuracy over the neck ----------------------------------------------

const SAMPLE_RATE = 48000;
const ONSET = 0.3;
const rooms = ["clean", "noisy", "laptop"];
const results = {};

for (const method of ["mpm", "yin"]) {
  const params = { ...PARAMS, method };
  for (const room of rooms) {
    const tally = { total: 0, correct: 0, octave: 0, harmonic: 0, other: 0, missed: 0, unpitched: 0, extra: 0, latency: [], onsetError: [], wrong: [] };
    for (let string = 1; string <= 6; string++) {
      for (let fret = 0; fret <= 12; fret++) {
        for (let take = 1; take <= 2; take++) {
          const midi = OPEN[string] + fret;
          const seed = string * 1000 + fret * 10 + take + (room === "clean" ? 0 : room === "noisy" ? 100000 : 200000);
          const samples = clip({ midis: [midi], onsets: [ONSET], sampleRate: SAMPLE_RATE, room, seed });
          const messages = run(samples, SAMPLE_RATE, params);
          tally.total++;
          if (messages.length === 0) {
            tally.missed++;
            tally.wrong.push(`s${string}f${fret}: nothing`);
            continue;
          }
          tally.extra += messages.length - 1;
          const first = messages[0];
          tally.onsetError.push((first.onsetTime - ONSET) * 1000);
          tally.latency.push((first.detectTime - ONSET) * 1000);
          if (first.type === "unpitched") {
            tally.unpitched++;
            tally.wrong.push(`s${string}f${fret}: unpitched`);
            continue;
          }
          const diff = first.midi - midi;
          if (diff === 0) tally.correct++;
          else {
            if (Math.abs(diff) === 12 || Math.abs(diff) === 24) tally.octave++;
            else if (diff === 19 || diff === 28) tally.harmonic++;
            else tally.other++;
            tally.wrong.push(`s${string}f${fret}: ${diff > 0 ? "+" : ""}${diff}`);
          }
        }
      }
    }
    results[`${method}/${room}`] = tally;
  }
}

console.log("\nAccuracy, 78 notes x 2 takes per room (strings 1-6, frets 0-12)\n");
console.log("method/room      correct   octave  harm(+19)  other  unpitched  missed  extra   onset err p95   latency p50/p95");
for (const [key, r] of Object.entries(results)) {
  const pct = ((100 * r.correct) / r.total).toFixed(1);
  console.log(
    `${key.padEnd(16)} ${(pct + "%").padStart(7)}   ${String(r.octave).padStart(6)}  ${String(r.harmonic).padStart(9)}  ${String(r.other).padStart(5)}  ${String(r.unpitched).padStart(9)}  ${String(r.missed).padStart(6)}  ${String(r.extra).padStart(5)}   ${percentile(r.onsetError.map(Math.abs), 95).toFixed(1).padStart(8)} ms   ${percentile(r.latency, 50).toFixed(0).padStart(5)} / ${percentile(r.latency, 95).toFixed(0)} ms`,
  );
}
for (const [key, r] of Object.entries(results)) {
  if (r.wrong.length) console.log(`  ${key} misses: ${r.wrong.slice(0, 12).join(", ")}${r.wrong.length > 12 ? ", …" : ""}`);
}
console.log("");

const chosen = results[`${PARAMS.method}/clean`];
check(chosen.correct / chosen.total >= 0.95, `${PARAMS.method}: >= 95% on clean plucks`, `${chosen.correct}/${chosen.total}`);
check(chosen.extra === 0, `${PARAMS.method}: one event per clean pluck`, `${chosen.extra} extra`);
check(percentile(chosen.latency, 95) <= 120, `${PARAMS.method}: onset -> pitch p95 within 120 ms`, `${percentile(chosen.latency, 95).toFixed(0)} ms`);

// --- Things that must not happen, and edge cases ---------------------------

{
  const random = rng(7);
  const samples = new Float32Array(SAMPLE_RATE * 5);
  addNoise(samples, 0.01, random);
  // A fan's hum and a swell in the noise: neither is a pluck.
  for (let i = 0; i < samples.length; i++) {
    samples[i] += 0.01 * Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE) * (1 + Math.sin((2 * Math.PI * 0.5 * i) / SAMPLE_RATE));
  }
  const messages = run(samples, SAMPLE_RATE);
  check(messages.length === 0, "noise and hum alone: no events", `${messages.length} events`);
}

{
  const samples = clip({ midis: [57, 57], onsets: [0.3, 0.45], sampleRate: SAMPLE_RATE, room: "clean", seed: 11 });
  const notes = run(samples, SAMPLE_RATE).filter((m) => m.type === "note" && m.midi === 57);
  check(notes.length === 2, "same note plucked twice, 150 ms apart", `${notes.length} notes`);
}

{
  const samples = clip({ midis: [57, 60, 64], onsets: [0.3, 0.6, 0.9], sampleRate: SAMPLE_RATE, room: "clean", seed: 12 });
  const midis = run(samples, SAMPLE_RATE).filter((m) => m.type === "note").map((m) => m.midi);
  check(midis.join(",") === "57,60,64", "A3 C4 E4 in a row, 300 ms apart", midis.join(","));
}

{
  // Not a pass/fail: a known limit, reported so it is not forgotten. When the
  // earlier notes keep ringing on other strings, the window holds a chord.
  const samples = clip({ midis: [57, 60, 64], onsets: [0.3, 0.6, 0.9], sampleRate: SAMPLE_RATE, room: "clean", seed: 12, ringOver: true });
  const heard = run(samples, SAMPLE_RATE).map((m) => (m.type === "note" ? m.midi : "?"));
  console.log(`info A3 C4 E4 left ringing on three strings          ${heard.join(",")}  (? = onset heard, no single pitch)`);
}

{
  // Re-plucking a note that is still loud: the case a plain energy gate misses.
  const samples = clip({ midis: [52, 52, 52], onsets: [0.3, 0.5, 0.7], sampleRate: SAMPLE_RATE, room: "noisy", seed: 14, ringOver: true });
  const notes = run(samples, SAMPLE_RATE).filter((m) => m.type === "note");
  check(notes.length === 3, "E3 re-plucked while ringing, noisy room", `${notes.length} notes`);
}

{
  const samples = clip({ midis: [88], onsets: [0.3], sampleRate: SAMPLE_RATE, room: "clean", seed: 13 });
  const notes = run(samples, SAMPLE_RATE).filter((m) => m.type === "note");
  check(notes[0]?.midi === 88, "E6, the 24th fret (1319 Hz)", notes[0] ? `${notes[0].hz.toFixed(1)} Hz, midi ${notes[0].midi}` : "nothing");
}

{
  let correct = 0;
  let total = 0;
  for (let string = 1; string <= 6; string++) {
    for (const fret of [0, 5, 12]) {
      const midi = OPEN[string] + fret;
      const notes = run(clip({ midis: [midi], onsets: [0.3], sampleRate: 44100, room: "clean", seed: 500 + string * 20 + fret }), 44100).filter((m) => m.type === "note");
      total++;
      if (notes[0]?.midi === midi) correct++;
    }
  }
  check(correct === total, "44.1 kHz input", `${correct}/${total}`);
}

{
  const cents = [];
  for (const midi of [40, 52, 57, 64, 76]) {
    const notes = run(clip({ midis: [midi], onsets: [0.3], sampleRate: SAMPLE_RATE, room: "clean", seed: 900 + midi }), SAMPLE_RATE).filter((m) => m.type === "note");
    if (notes[0]) cents.push(Math.abs(notes[0].cents));
  }
  check(Math.max(...cents) < 10, "in-tune plucks read within 10 cents", `worst ${Math.max(...cents).toFixed(1)} cents`);
}

{
  // The browser's own test signal (`?debug&source=synth`), rendered here
  // through a stand-in AudioContext. Strictly harmonic and noiseless, like a
  // clean DI guitar: this is the signal that exposed the 512-sample onset
  // frame, so it stays as a regression test.
  let data = new Float32Array(0);
  synthSource({
    sampleRate: SAMPLE_RATE,
    createBuffer: (_channels, length) => {
      data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource: () => ({ start() {} }),
  });
  const twice = new Float32Array(data.length * 2);
  twice.set(data);
  twice.set(data, data.length);
  const heard = run(twice, SAMPLE_RATE).map((m) => (m.type === "note" ? m.midi : "?"));
  // The very first note of the buffer has no "before" to rise from; every
  // other one, including the loop's restart, must be heard exactly once.
  const expected = [...SYNTH_SEQUENCE.slice(1), ...SYNTH_SEQUENCE];
  check(heard.join(",") === expected.join(","), "browser test signal, two loops", heard.join(","));
}

{
  // The event stream's own rules, over hand-written messages.
  const note = (midi, at) => ({ type: "note", onsetTime: at, detectTime: at + 0.06, hz: 440, midi, cents: 0, confidence: 0.95, rms: 0.1, window: 2048 });
  const unpitched = (at) => ({ type: "unpitched", onsetTime: at, detectTime: at + 0.06, rms: 0.1 });
  const stream = new NoteEvents();
  const kinds = [note(57, 1.0), note(57, 1.05), unpitched(1.1), note(57, 1.2), note(60, 1.25), unpitched(1.6)]
    .map((m) => stream.accept(m)?.kind ?? "-")
    .join(",");
  check(kinds === "note,-,-,note,note,unclear", "events: re-trigger and tail dropped, rest kept", kinds);
}

{
  // The octave check (off by default; the lab decides). Two questions: does it
  // fix the octave trap, and does it cost anything on ordinary plucks?
  const errors = (params, oddGain, room) => {
    let wrong = 0;
    let total = 0;
    for (let string = 1; string <= 6; string++) {
      for (let fret = 0; fret <= 12; fret += oddGain < 1 ? 4 : 1) {
        const midi = OPEN[string] + fret;
        const notes = run(clip({ midis: [midi], onsets: [0.3], sampleRate: SAMPLE_RATE, room, seed: 3000 + string * 31 + fret, oddGain }), SAMPLE_RATE, params).filter((m) => m.type === "note");
        total++;
        if (notes[0]?.midi !== midi) wrong++;
      }
    }
    return { wrong, total };
  };
  const off = { ...PARAMS, octaveCheck: false };
  const on = { ...PARAMS, octaveCheck: true };
  for (const oddGain of [0.3, 0.15]) {
    const a = errors(off, oddGain, "noisy");
    const b = errors(on, oddGain, "noisy");
    console.log(`info octave trap (odd partials x${oddGain}), noisy room: wrong ${a.wrong}/${a.total} without the check, ${b.wrong}/${b.total} with it`);
  }
  for (const room of rooms) {
    const b = errors(on, 1, room);
    check(b.wrong === 0, `octave check costs nothing on plucks, ${room}`, `${b.wrong}/${b.total} wrong`);
  }
}

// --- Cost on the audio thread ---------------------------------------------

{
  const random = rng(3);
  for (const method of ["mpm", "yin"]) {
    for (const size of [2048, 4096]) {
      const detector = createPitchDetector(4096, SAMPLE_RATE, { ...PARAMS, method });
      const samples = new Float32Array(size);
      pluck(samples, 0, 82.41, SAMPLE_RATE, random, 0.3);
      for (let i = 0; i < 20; i++) detector.detect(samples, size);
      const times = [];
      for (let i = 0; i < 200; i++) {
        const start = performance.now();
        detector.detect(samples, size);
        times.push(performance.now() - start);
      }
      console.log(`cost ${method} window ${size}: median ${percentile(times, 50).toFixed(2)} ms, p95 ${percentile(times, 95).toFixed(2)} ms (render quantum is 2.67 ms)`);
    }
  }
}

console.log(failures.length === 0 ? "\nall good" : `\n${failures.length} failed: ${failures.join("; ")}`);
process.exitCode = failures.length === 0 ? 0 : 1;
