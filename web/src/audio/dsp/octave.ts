/**
 * Is the fundamental really lower than the pitch detector said?
 *
 * Time-domain detectors make one family of mistakes: when a note's odd
 * partials are weak (a laptop microphone that barely hears the thick strings,
 * a string plucked near its middle), the waveform nearly repeats at half its
 * period, and the detector reports the octave above. The team's prototype
 * README records the related case, A4 read as E5: a period of 2T/3, a fifth
 * above.
 *
 * The test is in the spectrum, where the two answers differ. If the truth is
 * f/2, there is energy at f/2, 3f/2, 5f/2 — places where a note at f has none.
 * So for each lower candidate (f/2, f/3, 2f/3), the partials that candidate
 * has and f does not are measured against f's own. The best-supported
 * candidate whose support reaches `octaveCheckRatio` replaces f.
 *
 * A candidate partial too close to one of f's for the window to resolve is
 * not measured at all: what is there is f's own leakage. Without this, a
 * 2048 window scored 2f/3 on notes at 117-165 Hz once their upper partials had
 * decayed: on lab/data/synthetic, read 30-150 ms after the onset, 59 clips came
 * out a fifth low before this rule and 3 after (lab run 20261102-192956).
 *
 * Pure; one zero-padded FFT per call (~0.3 ms for a 4096 window).
 */

import type { DetectorParams } from "../params";
import { Fft } from "./fft";

/** Partials are looked for within this fraction of their ideal frequency: strings run sharp. */
const PARTIAL_TOLERANCE = 0.03;
/** Above this, a guitar's partials are weak and a laptop microphone's noise is not. */
const MAX_PARTIAL_HZ = 5000;
/** How many partials of each kind are averaged. */
const PARTIALS = 6;
/** Candidates within this much of the best are tied, and the tie goes to the lowest. */
const TIE = 0.9;

const CANDIDATES = [1 / 2, 1 / 3, 2 / 3];

export class OctaveCheck {
  private readonly fft: Fft;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly magnitude: Float64Array;
  private binHz = 0;
  private lobeHz = 0;

  constructor(
    maxSize: number,
    private readonly sampleRate: number,
    private readonly params: DetectorParams,
  ) {
    // Four times zero-padded: at 48 kHz a 2048 window gets 5.9 Hz bins, fine
    // enough to tell 82 Hz from 87 Hz.
    const size = Math.pow(2, Math.ceil(Math.log2(maxSize * 4)));
    this.fft = new Fft(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.magnitude = new Float64Array(size / 2);
  }

  /** Returns `hz`, or the lower fundamental the spectrum supports instead. */
  check(samples: Float32Array, length: number, hz: number): number {
    this.spectrum(samples, length);

    const own = this.support(hz, PARTIALS);
    if (own <= 0) return hz;

    const scores = CANDIDATES.map((fraction) => {
      const candidate = hz * fraction;
      if (candidate < this.params.minHz) return { candidate, score: 0 };
      return { candidate, score: this.support(candidate, PARTIALS, hz) / own };
    });
    const top = Math.max(...scores.map((entry) => entry.score));
    if (top < this.params.octaveCheckRatio) return hz;

    // Near-ties go to the lowest candidate: f/3 explains everything 2f/3 does.
    let best = hz;
    for (const { candidate, score } of scores) {
      if (score >= top * TIE && candidate < best) best = candidate;
    }
    return best;
  }

  private spectrum(samples: Float32Array, length: number) {
    const { re, im } = this;
    re.fill(0);
    im.fill(0);
    let mean = 0;
    for (let i = 0; i < length; i++) mean += samples[i];
    mean /= length;
    for (let i = 0; i < length; i++) {
      re[i] = (samples[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length));
    }
    this.fft.transform(re, im);
    for (let k = 0; k < this.magnitude.length; k++) this.magnitude[k] = Math.hypot(re[k], im[k]);
    this.binHz = this.sampleRate / this.fft.size;
    // A Hann window's main lobe reaches two bins of the unpadded window either side.
    this.lobeHz = (2 * this.sampleRate) / length;
  }

  /**
   * Mean peak magnitude at the first `count` partials of `base`, skipping any
   * that coincide with a partial of `exclude`, or sit inside its main lobe,
   * so that a candidate is scored only on what it explains and the detected
   * pitch does not.
   */
  private support(base: number, count: number, exclude?: number): number {
    let total = 0;
    let used = 0;
    for (let k = 1; used < count; k++) {
      const frequency = k * base;
      if (frequency > Math.min(MAX_PARTIAL_HZ, this.sampleRate / 2 - base)) break;
      if (exclude !== undefined) {
        const nearest = Math.max(1, Math.round(frequency / exclude));
        if (Math.abs(frequency - nearest * exclude) < this.lobeHz + this.searchHz(frequency)) continue;
      }
      total += this.peakNear(frequency);
      used++;
    }
    return used > 0 ? total / used : 0;
  }

  /** How far either side of a partial `peakNear` looks. */
  private searchHz(frequency: number): number {
    return Math.max(2 * this.binHz, frequency * PARTIAL_TOLERANCE);
  }

  private peakNear(frequency: number): number {
    const width = this.searchHz(frequency) / this.binHz;
    const centre = frequency / this.binHz;
    const from = Math.max(1, Math.floor(centre - width));
    const to = Math.min(this.magnitude.length - 1, Math.ceil(centre + width));
    let peak = 0;
    for (let k = from; k <= to; k++) if (this.magnitude[k] > peak) peak = this.magnitude[k];
    return peak;
  }
}
