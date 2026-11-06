/**
 * Hearing a pitch.
 *
 * This is the one thing in the whole app that listens. Tuning cannot be done by
 * looking: a slack string and a tight one are the same picture.
 *
 * The method is the McLeod Pitch Method — the normalised square difference
 * function, which is autocorrelation with the amplitude divided back out. Plain
 * autocorrelation was tried first and is wrong for this job in a specific way:
 * its peaks shrink as the tau grows, so a low E is systematically read as its
 * own octave, and a student is told their thickest string is a whole octave
 * sharp while they stare at a tuner that will not settle. Normalising kills
 * that bias, which is the entire reason the extra division is here.
 *
 *   n(tau) = 2 · Σ xᵢ·xᵢ₊ₜ  /  Σ (xᵢ² + xᵢ₊ₜ²)
 *
 * Then: the *first* peak within 90% of the best one, not the best one. A
 * plucked string is rich in harmonics, and the strongest peak is often the
 * octave. Taking the first strong peak is what keeps a tuner honest about which
 * note is fundamental.
 *
 * Pure arithmetic over a buffer of samples — no microphone, no AudioContext —
 * so it can be checked against a synthesised sine without a guitar in the room.
 */

/** Below the thick E with room to spare: a badly slack string still reads. */
const MIN_FREQUENCY = 60;

/** Above anything an open string can be, harmonics included. */
const MAX_FREQUENCY = 1000;

/** Quieter than this is a room, not a note. */
const SILENCE_RMS = 0.008;

/**
 * How peaked the correlation has to be before the answer is believed.
 *
 * Measured rather than guessed. Against a synthesised pluck buried in white
 * noise, clarity falls off with the signal: at a clean ~26 dB it sits above
 * 0.99, at ~12 dB it is 0.97 and the answer is still within two cents, and at
 * ~6 dB it is 0.88 while the answer has drifted twenty-three cents — confidently
 * wrong, which for a tuner is worse than silent. The line goes above that.
 */
const MIN_CLARITY = 0.93;

export interface PitchReading {
  frequency: number;
  /** 0 to 1: how periodic the signal is. A struck string is well above 0.9. */
  clarity: number;
  /** Loudness, for telling silence from a quiet note. */
  rms: number;
}

export function detectPitch(samples: Float32Array, sampleRate: number): PitchReading | null {
  const size = samples.length;
  if (size < 512) return null;

  // Mean removal first. A DC offset — which cheap interfaces do have — adds a
  // constant to every lag and flattens the whole function towards 1.
  let mean = 0;
  for (let i = 0; i < size; i++) mean += samples[i];
  mean /= size;

  const signal = new Float32Array(size);
  let sumSquares = 0;
  for (let i = 0; i < size; i++) {
    const value = samples[i] - mean;
    signal[i] = value;
    sumSquares += value * value;
  }

  const rms = Math.sqrt(sumSquares / size);
  if (rms < SILENCE_RMS) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / MAX_FREQUENCY));
  const maxTau = Math.min(Math.floor(size / 2), Math.floor(sampleRate / MIN_FREQUENCY));
  if (maxTau <= minTau + 2) return null;

  const nsdf = new Float32Array(maxTau + 2);
  for (let tau = minTau; tau <= maxTau; tau++) {
    let correlation = 0;
    let energy = 0;
    const last = size - tau;
    for (let i = 0; i < last; i++) {
      const a = signal[i];
      const b = signal[i + tau];
      correlation += a * b;
      energy += a * a + b * b;
    }
    nsdf[tau] = energy > 0 ? (2 * correlation) / energy : 0;
  }

  const peaks = localMaxima(nsdf, minTau, maxTau);
  if (peaks.length === 0) return null;

  let best = 0;
  for (const tau of peaks) best = Math.max(best, nsdf[tau]);
  if (best < MIN_CLARITY) return null;

  // The first peak that is nearly as good as the best one. See the note above:
  // the best peak is frequently the octave of the answer.
  const chosen = peaks.find((tau) => nsdf[tau] >= best * 0.9) ?? peaks[0];
  const refined = interpolate(nsdf, chosen);

  const frequency = sampleRate / refined;
  if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null;

  return { frequency, clarity: nsdf[chosen], rms };
}

/** Every local maximum of the function, in order of increasing lag. */
function localMaxima(nsdf: Float32Array, minTau: number, maxTau: number): number[] {
  const peaks: number[] = [];
  // Skip the initial descent from n(0) = 1, which is not a peak but the
  // function's own starting point.
  let tau = minTau;
  while (tau < maxTau && nsdf[tau] > nsdf[tau + 1]) tau++;

  for (; tau < maxTau; tau++) {
    if (nsdf[tau] > 0 && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] > nsdf[tau + 1]) {
      peaks.push(tau);
      // Past the top; walk down before looking for the next one.
      while (tau < maxTau && nsdf[tau] >= nsdf[tau + 1]) tau++;
    }
  }
  return peaks;
}

/**
 * Sub-sample accuracy by fitting a parabola through the peak and its
 * neighbours. Without it the answer is quantised to whole samples, which near
 * the thin E is worth several cents — enough to leave a string visibly out of
 * tune while the tuner claims it is not.
 */
function interpolate(nsdf: Float32Array, tau: number): number {
  const before = nsdf[tau - 1];
  const here = nsdf[tau];
  const after = nsdf[tau + 1];
  const curvature = before - 2 * here + after;
  if (curvature === 0) return tau;
  const shift = (0.5 * (before - after)) / curvature;
  // A shift beyond half a sample means the parabola did not fit; trust the bin.
  return Math.abs(shift) < 1 ? tau + shift : tau;
}
