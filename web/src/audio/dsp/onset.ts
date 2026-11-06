/**
 * When a note starts.
 *
 * Spectral flux: how much louder each frequency got since a moment ago,
 * counting only increases. A pluck is a sudden broadband jump; a note ringing
 * out only ever gets quieter, so its flux sits near zero however loud it is.
 * That is what lets the detector hear a second pluck of the same note over
 * the first one still sounding, which a plain energy threshold cannot.
 *
 * It is the SuperFlux variant (Böck & Widmer, DAFx 2013): each bin is compared
 * with the loudest of its neighbours `fluxLag` hops ago, not with itself one
 * hop ago. A low string's partials sit closer together than one FFT bin, so
 * they beat, and plain flux hears every beat as a small attack: on synthetic
 * plucks (`note-check`), spikes in the decay reached 33 against onsets as low
 * as 45. The neighbour maximum cancels beating and vibrato; a real attack
 * rises in every bin at once and survives it.
 *
 * Two gates guard it. The flux has to stand well above its own recent average
 * (an adaptive threshold, so a busy room raises the bar), and the frame has to
 * be louder than the room's noise floor. After an onset, a refractory period
 * stops one pluck's ragged attack from counting twice.
 *
 * Pure: frames in, decisions out, no clock but the sample count.
 */

import type { DetectorParams } from "../params";
import { Spectrum } from "./fft";

export class OnsetDetector {
  private readonly spectrum: Spectrum;
  private readonly magnitudes: Float32Array;
  /** The last `fluxLag + 1` log spectra, newest at `newest`. */
  private readonly past: Float32Array[];
  private newest = 0;
  private framesSeen = 0;
  private readonly fluxBins: number;
  private readonly history: Float32Array;
  private historyIndex = 0;
  private historyFilled = 0;
  private readonly refractory: number;
  private sinceOnset = Number.POSITIVE_INFINITY;
  private armed = true;

  /** The last flux computed, for the debug readout and the harness. */
  lastFlux = 0;

  constructor(
    private readonly params: DetectorParams,
    sampleRate: number,
  ) {
    this.spectrum = new Spectrum(params.frameSize);
    this.magnitudes = new Float32Array(params.frameSize / 2);
    this.past = [];
    for (let i = 0; i <= params.fluxLag; i++) this.past.push(new Float32Array(params.frameSize / 2));
    const binHz = sampleRate / params.frameSize;
    this.fluxBins = Math.min(params.frameSize / 2, Math.ceil(params.fluxMaxHz / binHz));
    this.history = new Float32Array(params.fluxHistory);
    this.refractory = Math.round((params.refractoryMs / 1000) * sampleRate);
  }

  /**
   * Feeds the newest `frameSize` samples, one hop after the last call.
   * `loudEnough` is the caller's noise gate. Returns true on an onset.
   */
  step(frame: Float32Array, loudEnough: boolean): boolean {
    this.spectrum.magnitudes(frame, this.magnitudes);

    // Rotate the history in place (no allocation: this is the audio thread).
    const slots = this.past.length;
    this.newest = (this.newest + 1) % slots;
    const now = this.past[this.newest];
    // The oldest slot is the one about to be overwritten next time: fluxLag ago.
    const before = this.past[(this.newest + 1) % slots];

    // Log compression: an onset is a *relative* jump. Without it, the thick
    // E's attack, mostly low bins at high amplitude, would drown every other
    // string's, and loud playing would set the bar for quiet playing.
    for (let k = 0; k < this.magnitudes.length; k++) now[k] = Math.log1p(100 * this.magnitudes[k]);

    const reach = this.params.fluxMaxFilter;
    let flux = 0;
    for (let k = 1; k < this.fluxBins; k++) {
      let reference = before[k];
      for (let j = Math.max(0, k - reach); j <= Math.min(now.length - 1, k + reach); j++) {
        if (before[j] > reference) reference = before[j];
      }
      if (now[k] > reference) flux += now[k] - reference;
    }
    this.framesSeen++;

    let mean = 0;
    for (let i = 0; i < this.historyFilled; i++) mean += this.history[i];
    mean = this.historyFilled > 0 ? mean / this.historyFilled : 0;

    this.history[this.historyIndex] = flux;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    this.historyFilled = Math.min(this.historyFilled + 1, this.history.length);
    this.sinceOnset += this.params.hopSize;

    // Until the history is full, the comparison is against silence and every
    // frame looks like an attack.
    if (this.framesSeen <= this.params.fluxLag) {
      this.lastFlux = 0;
      return false;
    }
    this.lastFlux = flux;

    const above = flux > this.params.fluxMin && flux > mean * this.params.fluxRatio;
    // Rising edge only: the flux has to fall back below the line before it can
    // fire again, so a long attack is one onset, not several.
    if (!above) {
      this.armed = true;
      return false;
    }
    if (!this.armed || !loudEnough || this.sinceOnset < this.refractory) return false;

    this.armed = false;
    this.sinceOnset = 0;
    return true;
  }
}

/**
 * A running estimate of how loud the room is when nobody is playing.
 *
 * It drops to any quieter reading at once and creeps up slowly, so it follows
 * the quiet moments between notes and ignores the notes themselves.
 */
export class NoiseFloor {
  private floor = 0;
  private readonly risePerHop: number;

  constructor(params: DetectorParams, sampleRate: number) {
    const hopsPerSecond = sampleRate / params.hopSize;
    this.risePerHop = Math.pow(10, params.floorRiseDbPerSecond / 20 / hopsPerSecond);
  }

  get value(): number {
    return this.floor;
  }

  update(rms: number): number {
    if (this.floor === 0 || rms < this.floor) this.floor = Math.max(rms, 1e-6);
    else this.floor *= this.risePerHop;
    return this.floor;
  }
}
