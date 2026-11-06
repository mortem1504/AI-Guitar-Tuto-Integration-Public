/**
 * Which note: two pitch detectors over one window of samples.
 *
 * Both answer the same question — "what period does this window repeat at?" —
 * and both are kept because which one reads a real guitar better is a
 * measurement, not an opinion (`PARAMS.method`, set from `note-check` now and
 * from the lab's recordings in Phase 2).
 *
 * - **MPM** (McLeod), adapted from `tuner/pitch.ts`: the normalised square
 *   difference, and the *first* peak within `mpmPeakRatio` of the best,
 *   because a plucked string's strongest peak is often its octave.
 * - **YIN** (de Cheveigné & Kawahara): the cumulative mean normalised
 *   difference, and the first dip below an absolute threshold.
 *
 * Differences from the tuner's copy: the search range is the whole guitar
 * (75-1400 Hz) instead of open strings; scratch memory is allocated once,
 * since this runs on the audio thread; and the correlation is computed with an
 * FFT. The tuner's direct loop costs O(window · lags): measured by
 * `note-check`, 2.5-2.9 ms for the 4096-sample window, longer than the 2.67 ms
 * the audio thread has per render quantum. Through the FFT it is a fraction
 * of that.
 */

import type { DetectorParams } from "../params";
import { Correlator } from "./fft";

export interface PitchEstimate {
  hz: number;
  /** 0-1. MPM: the NSDF peak's height. YIN: 1 minus the dip's depth. */
  confidence: number;
}

export interface PitchDetector {
  /** Reads the first `length` samples of `samples`. Null means no pitch. */
  detect(samples: Float32Array, length: number): PitchEstimate | null;
}

/** Shared by both: the lag range, mean removal, prefix sums, the correlator. */
abstract class LagSearch implements PitchDetector {
  protected readonly signal: Float64Array;
  /** prefix[k] = Σ_{i<k} x², so any run's energy is two lookups. */
  protected readonly prefix: Float64Array;
  protected readonly correlation: Float64Array;
  protected readonly curve: Float64Array;
  protected readonly correlator: Correlator;

  constructor(
    maxSize: number,
    protected readonly sampleRate: number,
    protected readonly params: DetectorParams,
  ) {
    this.signal = new Float64Array(maxSize);
    this.prefix = new Float64Array(maxSize + 1);
    this.correlation = new Float64Array(maxSize + 2);
    this.curve = new Float64Array(maxSize + 2);
    this.correlator = new Correlator(2 * maxSize);
  }

  protected lagRange(length: number, maxFraction: number): [number, number] {
    const minTau = Math.max(2, Math.floor(this.sampleRate / this.params.maxHz));
    const maxTau = Math.min(Math.floor(length * maxFraction), Math.ceil(this.sampleRate / this.params.minHz));
    return [minTau, maxTau];
  }

  /**
   * Copies the window with its mean removed and fills the prefix sums. A DC
   * offset, which cheap interfaces do have, adds a constant to every lag and
   * flattens the curve.
   */
  protected load(samples: Float32Array, length: number): number {
    let mean = 0;
    for (let i = 0; i < length; i++) mean += samples[i];
    mean /= length;
    const { signal, prefix } = this;
    prefix[0] = 0;
    for (let i = 0; i < length; i++) {
      const value = samples[i] - mean;
      signal[i] = value;
      prefix[i + 1] = prefix[i] + value * value;
    }
    return prefix[length];
  }

  protected toEstimate(tau: number, confidence: number): PitchEstimate | null {
    if (!(tau > 0)) return null;
    const hz = this.sampleRate / tau;
    if (hz < this.params.minHz || hz > this.params.maxHz) return null;
    return { hz, confidence };
  }

  abstract detect(samples: Float32Array, length: number): PitchEstimate | null;
}

export class Mpm extends LagSearch {
  detect(samples: Float32Array, length: number): PitchEstimate | null {
    if (length < 256) return null;
    if (this.load(samples, length) <= 0) return null;
    const { signal, prefix, correlation, curve } = this;

    // Half the window: past that, too few samples overlap to trust a peak.
    const [minTau, maxTau] = this.lagRange(length, 0.5);
    if (maxTau <= minTau + 2) return null;

    this.correlator.correlate(signal, length, signal, length, maxTau + 1, correlation);
    // n(τ) = 2·Σ x_i·x_{i+τ} / Σ (x_i² + x_{i+τ}²), the energy from the prefix sums.
    for (let tau = minTau - 1; tau <= maxTau + 1; tau++) {
      const last = length - tau;
      const norm = prefix[last] + prefix[length] - prefix[tau];
      curve[tau] = norm > 0 ? (2 * correlation[tau]) / norm : 0;
    }

    // Skip the initial descent from n(0) = 1: it is the function's starting
    // point, not a peak.
    let start = minTau;
    while (start < maxTau && curve[start] > curve[start + 1]) start++;

    let best = 0;
    for (let tau = start; tau < maxTau; tau++) {
      if (isPeak(curve, tau)) best = Math.max(best, curve[tau]);
    }
    if (best < this.params.mpmMinClarity) return null;

    for (let tau = start; tau < maxTau; tau++) {
      if (isPeak(curve, tau) && curve[tau] >= best * this.params.mpmPeakRatio) {
        return this.toEstimate(parabolicVertex(curve, tau), curve[tau]);
      }
    }
    return null;
  }
}

export class Yin extends LagSearch {
  detect(samples: Float32Array, length: number): PitchEstimate | null {
    if (length < 256) return null;
    if (this.load(samples, length) <= 0) return null;
    const { signal, prefix, correlation, curve } = this;

    // YIN integrates a fixed span, so the longest lag has to leave room for
    // it: the lag range is capped at a third of the window and the span is
    // everything past the longest lag.
    const [minTau, maxTau] = this.lagRange(length, 1 / 3);
    if (maxTau <= minTau + 2) return null;
    const span = length - maxTau - 1;

    // d(τ) = Σ_{i<span} (x_i - x_{i+τ})² = Σx_i² + Σx_{i+τ}² - 2·Σ x_i·x_{i+τ}
    this.correlator.correlate(signal, span, signal, length, maxTau + 1, correlation);
    const head = prefix[span];

    // Normalise by the cumulative mean so that d'(0) = 1 and the dips are
    // comparable across lags.
    curve[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      const diff = Math.max(0, head + prefix[tau + span] - prefix[tau] - 2 * correlation[tau]);
      running += diff;
      curve[tau] = running > 0 ? (diff * tau) / running : 1;
    }

    // First dip below the threshold, followed down to its bottom. Taking the
    // first rather than the deepest is YIN's own defence against octaves.
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (curve[tau] < this.params.yinThreshold) {
        while (tau + 1 <= maxTau && curve[tau + 1] < curve[tau]) tau++;
        return this.toEstimate(parabolicVertex(curve, tau), 1 - curve[tau]);
      }
    }
    return null;
  }
}

export function createPitchDetector(maxSize: number, sampleRate: number, params: DetectorParams): PitchDetector {
  return params.method === "yin" ? new Yin(maxSize, sampleRate, params) : new Mpm(maxSize, sampleRate, params);
}

function isPeak(curve: Float64Array, tau: number): boolean {
  return curve[tau] > 0 && curve[tau] >= curve[tau - 1] && curve[tau] > curve[tau + 1];
}

/**
 * Sub-sample accuracy by fitting a parabola through a peak (or dip) and its two
 * neighbours. Without it the answer is quantised to whole samples, which near
 * the top of the neck is worth tens of cents. The same formula serves both.
 */
function parabolicVertex(curve: Float64Array, tau: number): number {
  const before = curve[tau - 1];
  const here = curve[tau];
  const after = curve[tau + 1];
  const curvature = before - 2 * here + after;
  if (curvature === 0) return tau;
  const shift = (0.5 * (before - after)) / curvature;
  return Math.abs(shift) < 1 ? tau + shift : tau;
}
