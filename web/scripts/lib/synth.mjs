/**
 * Synthesised guitar plucks for the audio harnesses (`note-check`, later
 * `audio-check` and `fusion-check`). Deterministic: the same seed gives the
 * same clip, so a number in a comment can be reproduced.
 */

export const OPEN = [0, 64, 59, 55, 50, 45, 40];
export const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random) {
  return Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
}

/**
 * A plucked string as a sum of harmonics. Plucked at `position` along the
 * string, so some harmonics are weak, each decaying faster the higher it is,
 * slightly sharp the higher it is (inharmonicity), with a burst of pick noise.
 *
 * The partials start in phase, with signed amplitudes sin(kπp): the Fourier
 * series of a string released from a triangle. A first version gave each
 * partial a random phase, which smears the waveform into noise-like
 * smoothness and hid a real bug: a plucked low E is pulse-like, its 12 ms
 * period is longer than an 11 ms onset frame, and frame energy then swings
 * with every period, which plain flux hears as a stream of new onsets.
 */
export function pluck(out, at, hz, sampleRate, random, level, oddGain = 1) {
  const position = 0.1 + random() * 0.2;
  const inharmonicity = 0.00005 + random() * 0.0001;
  const length = out.length - at;
  for (let k = 1; k <= 40; k++) {
    const partial = k * hz * Math.sqrt(1 + inharmonicity * k * k);
    if (partial > sampleRate * 0.45) break;
    // oddGain < 1 weakens the odd partials, the fundamental included: the
    // "octave trap", where the waveform nearly repeats at half its period.
    const amplitude = ((k % 2 === 1 ? oddGain : 1) * Math.sin(k * Math.PI * position) * level) / Math.pow(k, 1.1);
    const decay = 1.6 / (1 + 0.35 * k);
    const phase = 0;
    // A rotating phasor and a constant per-sample decay: the same sine as
    // sin(phase + step * i) * exp(-t / decay), without a sin and an exp per sample.
    const step = (2 * Math.PI * partial) / sampleRate;
    const rotateCos = Math.cos(step);
    const rotateSin = Math.sin(step);
    const fade = Math.exp(-1 / (decay * sampleRate));
    const attackSamples = 0.002 * sampleRate;
    let re = Math.cos(phase) * amplitude;
    let im = Math.sin(phase) * amplitude;
    for (let i = 0; i < length; i++) {
      out[at + i] += im * Math.min(1, i / attackSamples);
      const nextRe = (re * rotateCos - im * rotateSin) * fade;
      im = (re * rotateSin + im * rotateCos) * fade;
      re = nextRe;
    }
  }
  const noiseLength = Math.round(0.006 * sampleRate);
  for (let i = 0; i < noiseLength && at + i < out.length; i++) {
    out[at + i] += gaussian(random) * level * 0.3 * Math.exp(-i / (0.0015 * sampleRate));
  }
}

export function rmsOf(samples, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function addNoise(samples, rms, random) {
  for (let i = 0; i < samples.length; i++) samples[i] += gaussian(random) * rms;
}

/** First-order high-pass: a laptop microphone barely hears below ~200 Hz. */
export function highPass(samples, cutoff, sampleRate) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = rc / (rc + 1 / sampleRate);
  let previousIn = 0;
  let previousOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i];
    const output = alpha * (previousOut + input - previousIn);
    previousIn = input;
    previousOut = output;
    samples[i] = output;
  }
}

/**
 * Builds one clip: a bit of room, then the plucks at the given times.
 *
 * By default each pluck damps the one before it, as on a single string or with
 * a fretting hand that lifts. `ringOver: true` lets every note keep sounding,
 * as when consecutive notes are on different strings and nobody mutes them.
 */
export function clip({ midis, onsets, sampleRate, room, seed, seconds = 1.5, ringOver = false, oddGain = 1 }) {
  const random = rng(seed);
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const level = 0.15 + random() * 0.15;
  midis.forEach((midi, i) => {
    const note = new Float32Array(samples.length);
    pluck(note, Math.round(onsets[i] * sampleRate), midiToHz(midi), sampleRate, random, level, oddGain);
    const next = onsets[i + 1];
    if (next !== undefined && !ringOver) {
      // A finger on the string: gone in ~15 ms.
      const from = Math.round(next * sampleRate);
      for (let j = from; j < note.length; j++) note[j] *= Math.exp(-(j - from) / (0.015 * sampleRate));
    }
    for (let j = 0; j < samples.length; j++) samples[j] += note[j];
  });
  const firstAt = Math.round(onsets[0] * sampleRate);
  const noteRms = rmsOf(samples, firstAt, firstAt + Math.round(0.1 * sampleRate));
  if (room === "laptop") highPass(samples, 250, sampleRate);
  const snrDb = room === "clean" ? 50 : room === "noisy" ? 20 : 25;
  addNoise(samples, noteRms * Math.pow(10, -snrDb / 20), random);
  return samples;
}
