/**
 * Samples in, note events out.
 *
 * This is the whole live note detector, and it is pure: it has no idea whether
 * it is running in an AudioWorklet fed by a microphone or in Node fed by a WAV
 * file. That is the point. `worklet/note-processor.ts` is a ten-line wrapper
 * around it, and `npm run note-check` (and Phase 2's `audio-check`) run this
 * same class over files, so the browser is measured against the same dataset
 * as the Python lab.
 *
 * Per render quantum (one hop):
 *   1. RMS of the hop, against a running noise floor.
 *   2. Spectral flux over the newest frame → onset or not.
 *   3. On an onset, wait for a window starting `pitchDelayMs` later, read its
 *      pitch, and, if the answer is below `extendBelowHz`, wait for the long
 *      window and read it again.
 *
 * Times are in seconds on the caller's clock: `startFrame` is the sample count
 * at which the first sample arrives, and in the worklet that is
 * `currentFrame`, so every time here is `AudioContext.currentTime`.
 */

import { centsBetween, frequencyOf } from "../../guitar/tuning";
import { scaledSamples, type DetectorParams } from "../params";
import { OctaveCheck } from "./octave";
import { NoiseFloor, OnsetDetector } from "./onset";
import { createPitchDetector, type PitchDetector } from "./pitch";

export interface NoteMessage {
  type: "note";
  onsetTime: number;
  /** When the pitch was settled: the end of the window that was read. */
  detectTime: number;
  hz: number;
  midi: number;
  /** How far from the equal-tempered `midi`, -50..50. */
  cents: number;
  confidence: number;
  rms: number;
  /** Samples in the window the answer came from. */
  window: number;
  /** The pitch detector's own answer, when the octave check replaced it. */
  rawHz: number | null;
}

/** An onset that was loud enough to be a note, with no pitch anyone would trust. */
export interface UnpitchedMessage {
  type: "unpitched";
  onsetTime: number;
  detectTime: number;
  rms: number;
}

export interface LevelMessage {
  type: "level";
  time: number;
  rms: number;
  peak: number;
  noiseFloor: number;
}

export type DetectorMessage = NoteMessage | UnpitchedMessage | LevelMessage;

interface Pending {
  onsetSample: number;
  start: number;
  length: number;
  long: boolean;
}

export function midiOf(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

export class NoteDetector {
  private readonly ring: Float32Array;
  private readonly mask: number;
  /** Absolute count of samples received. */
  private written = 0;

  private readonly frame: Float32Array;
  private readonly window: Float32Array;
  private readonly onset: OnsetDetector;
  private readonly floor: NoiseFloor;
  private readonly pitch: PitchDetector;
  private readonly octave: OctaveCheck | null;

  private readonly hop: number;
  private hopFill = 0;
  private hopSquares = 0;

  private readonly delay: number;
  private readonly shortWindow: number;
  private readonly longWindow: number;
  private pending: Pending | null = null;

  private readonly levelEvery: number;
  private levelFill = 0;
  private levelSquares = 0;
  private levelPeak = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly params: DetectorParams,
    private readonly emit: (message: DetectorMessage) => void,
    private readonly startFrame = 0,
  ) {
    this.hop = params.hopSize;
    this.delay = Math.round((params.pitchDelayMs / 1000) * sampleRate);
    this.shortWindow = scaledSamples(params.window, sampleRate);
    this.longWindow = scaledSamples(params.longWindow, sampleRate);

    // Big enough to hold the onset frame, the delay and the long window at once.
    const needed = params.frameSize + this.delay + this.longWindow + 2 * this.hop;
    const size = Math.pow(2, Math.ceil(Math.log2(needed)));
    this.ring = new Float32Array(size);
    this.mask = size - 1;

    this.frame = new Float32Array(params.frameSize);
    this.window = new Float32Array(this.longWindow);
    this.onset = new OnsetDetector(params, sampleRate);
    this.floor = new NoiseFloor(params, sampleRate);
    this.pitch = createPitchDetector(this.longWindow, sampleRate, params);
    this.octave = params.octaveCheck ? new OctaveCheck(this.longWindow, sampleRate, params) : null;
    this.levelEvery = Math.round((params.levelIntervalMs / 1000) * sampleRate);
  }

  /** The last onset frame's spectral flux. For the debug readout. */
  get flux(): number {
    return this.onset.lastFlux;
  }

  /** Accepts any number of samples; does its work on hop boundaries. */
  push(chunk: Float32Array) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = chunk[i];
      this.ring[this.written & this.mask] = sample;
      this.written++;

      const square = sample * sample;
      this.hopSquares += square;
      this.levelSquares += square;
      const magnitude = Math.abs(sample);
      if (magnitude > this.levelPeak) this.levelPeak = magnitude;

      if (++this.hopFill === this.hop) this.onHop();
      if (++this.levelFill === this.levelEvery) this.onLevel();
    }
  }

  private timeOf(sample: number): number {
    return (this.startFrame + sample) / this.sampleRate;
  }

  private onHop() {
    const rms = Math.sqrt(this.hopSquares / this.hop);
    this.hopFill = 0;
    this.hopSquares = 0;

    // Gate on the floor as it stood *before* this hop: a loud hop must not
    // vouch for itself.
    const floorBefore = this.floor.value;
    const loudEnough = rms > Math.max(this.params.minRms, floorBefore * this.params.gateAboveFloor);
    this.floor.update(rms);

    if (this.written >= this.frame.length) {
      this.copyOut(this.written - this.frame.length, this.frame.length, this.frame);
      if (this.onset.step(this.frame, loudEnough)) {
        // The jump happened somewhere in the newest hop; its start is the
        // best single answer and is within one hop (2.7 ms) of the truth.
        const onsetSample = this.written - this.hop;
        // A newer pluck replaces an older one still waiting for its window:
        // the student has moved on, and so does the verdict.
        this.pending = {
          onsetSample,
          start: onsetSample + this.delay,
          length: this.shortWindow,
          long: false,
        };
      }
    }

    this.checkPending();
  }

  private checkPending() {
    const pending = this.pending;
    if (!pending || this.written < pending.start + pending.length) return;

    this.copyOut(pending.start, pending.length, this.window);
    const rms = rmsOf(this.window, pending.length);
    const estimate = this.pitch.detect(this.window, pending.length);
    // Before the window decision, so a low E corrected down from E3 still gets
    // the long window it needs.
    const hz = estimate && this.octave ? this.octave.check(this.window, pending.length, estimate.hz) : estimate?.hz;

    // The thick E's lowest notes fit too few periods in the short window to be
    // trusted; read them again over twice as many before answering.
    if (hz !== undefined && !pending.long && hz < this.params.extendBelowHz && this.longWindow > pending.length) {
      pending.length = this.longWindow;
      pending.long = true;
      return;
    }

    this.pending = null;
    const onsetTime = this.timeOf(pending.onsetSample);
    const detectTime = this.timeOf(pending.start + pending.length);

    if (!estimate || hz === undefined) {
      this.emit({ type: "unpitched", onsetTime, detectTime, rms });
      return;
    }

    const midi = midiOf(hz);
    this.emit({
      type: "note",
      onsetTime,
      detectTime,
      hz,
      midi,
      cents: centsBetween(hz, frequencyOf(midi)),
      confidence: estimate.confidence,
      rms,
      window: pending.length,
      rawHz: hz !== estimate.hz ? estimate.hz : null,
    });
  }

  private onLevel() {
    this.emit({
      type: "level",
      time: this.timeOf(this.written),
      rms: Math.sqrt(this.levelSquares / this.levelFill),
      peak: this.levelPeak,
      noiseFloor: this.floor.value,
    });
    this.levelFill = 0;
    this.levelSquares = 0;
    this.levelPeak = 0;
  }

  private copyOut(start: number, length: number, into: Float32Array) {
    for (let i = 0; i < length; i++) into[i] = this.ring[(start + i) & this.mask];
  }
}

function rmsOf(samples: Float32Array, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / length);
}
