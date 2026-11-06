/**
 * Every tuned number in the note detector, in one place.
 *
 * Two layers. `DEFAULTS` below is written by hand, and each constant says
 * where its value came from — mostly `npm run note-check` over synthesised
 * plucks, which is a fair test of the maths and a poor test of a room. On top
 * of it, `params.lab.ts` is *generated* by `lab/export_params.py` from an
 * evaluation run over recordings of a real guitar; it names the run, and its
 * values win. The lab reads both files back (`lab/src/audio/web_params.py`),
 * so the browser and the lab can never disagree about what is being measured.
 */

import { LAB_OVERRIDES } from "./params.lab";

export type PitchMethod = "mpm" | "yin";

export interface DetectorParams {
  /** FFT frame for the onset detector, in samples. */
  frameSize: number;
  /** Hop between onset frames, in samples. One render quantum. */
  hopSize: number;
  /** Spectral flux only counts bins below this. Above it is mostly hiss. */
  fluxMaxHz: number;
  /** SuperFlux: compare against the spectrum this many hops ago... */
  fluxLag: number;
  /** ...taking the loudest of this many bins either side. */
  fluxMaxFilter: number;
  /** How many past hops the adaptive flux threshold averages. */
  fluxHistory: number;
  /** An onset needs flux this many times the recent mean... */
  fluxRatio: number;
  /** ...and at least this much in absolute terms. */
  fluxMin: number;
  /** A second onset sooner than this after the last one is the same pluck. */
  refractoryMs: number;

  /** Quieter than this (RMS, full scale = 1) is never a note. */
  minRms: number;
  /** An onset has to be this many times louder than the noise floor. */
  gateAboveFloor: number;
  /** How fast the noise floor may rise, in dB per second. It falls instantly. */
  floorRiseDbPerSecond: number;

  /** Pitch is read from a window that starts this long after the onset. */
  pitchDelayMs: number;
  /** Pitch window at 48 kHz, in samples; scaled with the sample rate. */
  window: number;
  /** Longer window used when the first estimate is below `extendBelowHz`. */
  longWindow: number;
  extendBelowHz: number;

  /** The search range. A guitar spans E2 (82 Hz) to E6 (1319 Hz) on 24 frets. */
  minHz: number;
  maxHz: number;

  method: PitchMethod;
  /** MPM: take the first NSDF peak at least this fraction of the best. */
  mpmPeakRatio: number;
  /** MPM: below this clarity there is no pitch. */
  mpmMinClarity: number;
  /** YIN: the absolute threshold on the cumulative mean normalised difference. */
  yinThreshold: number;

  /**
   * The octave check: after a pitch is found, look for partials that only a
   * lower fundamental (f/2, f/3 or 2f/3) would have. Off until the lab shows
   * it helps on real recordings.
   */
  octaveCheck: boolean;
  /** A lower candidate wins when its own partials reach this fraction of f's. */
  octaveCheckRatio: number;

  /**
   * The exercise-aware prior, applied when judging against a known target
   * (`prior.ts`): a note exactly 12 or 19 semitones from the target, read with
   * confidence below this, is judged as the target's octave.
   */
  priorMaxConfidence: number;

  /** How often a level reading is sent to the main thread. */
  levelIntervalMs: number;
}

const DEFAULTS: DetectorParams = {
  // 1024 at 48 kHz is ~21 ms, which holds 1.7 periods of the thick E. 512
  // (11 ms) was tried first and is shorter than one 12 ms period: a plucked
  // low E is pulse-like, so frame energy swung with each period and the
  // flux fired every ~65 ms all through the note (28-33 false onsets per 19
  // real ones, at every noise level, on `synthSource`'s sequence). 1024: no
  // false onsets and no added onset lag. 2048 began to misfire and lag 13 ms.
  frameSize: 1024,
  // 128 is the Web Audio render quantum, so the detector runs once per call.
  hopSize: 128,
  fluxMaxHz: 6000,
  // The SuperFlux paper's defaults at this hop size (its mu = 2, max filter 3).
  fluxLag: 2,
  fluxMaxFilter: 1,
  fluxHistory: 16,
  // note-check, synthetic plucks, SuperFlux over 1024-sample frames. The
  // highest spike inside a decaying note was 18 (laptop room); onsets from
  // silence scored 57 or more; the hard case, the same note re-plucked at the
  // same loudness 150 ms later, peaked at 28. A sweep of fluxMin over 18-30
  // (ratio 3) passed every check at 18 and 22, missed re-plucks from 26. 22
  // sits in the gap with ~4 either side: measure it again on real repeated
  // notes in Phase 2.
  fluxRatio: 3,
  fluxMin: 22,
  // A safety margin, not a measured need: with the refractory period set to
  // zero, note-check's synthetic plucks never re-fired. A real pick scraping
  // a string may. 60 ms stays well under the 125 ms between sixteenths at
  // 120 bpm, so it cannot swallow a real repeated note.
  refractoryMs: 60,

  // About -54 dBFS. A starting guess, not a measurement: Phase 2 records the
  // noise floors of real built-in microphones and interfaces.
  minRms: 0.002,
  // ~10 dB above the room. A guess, for the same reason.
  gateAboveFloor: 3,
  // Slow enough that a note held for seconds does not become "the room".
  floorRiseDbPerSecond: 3,

  // From the build brief: skip the pick noise at the very start of the note.
  // On real recordings 30 ms reads better (IDMT-SMT-Guitar V2, 312 notes:
  // 97.1% -> 99.7%), so params.lab.ts overrides this with 30.
  pitchDelayMs: 20,
  // 2048 at 48 kHz is ~43 ms: three and a half periods of the thick E.
  window: 2048,
  // The thick E's lowest three notes (E2, F2, F#2) fit only ~3.5 periods in
  // the short window; doubling it for them costs ~43 ms of latency.
  longWindow: 4096,
  extendBelowHz: 120,

  minHz: 75,
  maxHz: 1400,

  // note-check: MPM and YIN both read 100% of synthetic plucks in all three
  // rooms, so synthesis cannot pick between them. MPM is kept for now because
  // it costs less on the audio thread (0.6 ms vs 0.8 ms a window) and is the
  // tuner's method. Phase 2's recordings decide.
  method: "mpm",
  // Same rule as the tuner (`tuner/pitch.ts`): the best peak is often the
  // octave, so the first nearly-as-good one is taken.
  mpmPeakRatio: 0.9,
  // note-check: synthetic plucks read clarity 0.945 at worst (laptop room,
  // median 0.97-0.99); windows of white noise peak at 0.11. 0.8 leaves room
  // below for real guitars, which will be less clean than synthesis. Lower
  // than the tuner's 0.93, which was set on long steady windows, not 43 ms
  // right after an attack.
  mpmMinClarity: 0.8,
  // The YIN paper's recommended range is 0.10-0.15.
  yinThreshold: 0.15,

  // Off: on synthesised plucks nothing needs fixing, so whether it helps (and
  // what it costs on correct notes) is the lab's question. The ratio is a
  // starting guess between "no partials there" (noise, ~0.05 of f's) and the
  // weak odd partials of an octave trap in `note-check` (~0.15-0.3).
  octaveCheck: false,
  octaveCheckRatio: 0.1,

  // A starting guess: synthesised plucks read 0.945-0.99, so "not high" is
  // anything under the clean median. The lab measures the false-accept cost.
  priorMaxConfidence: 0.97,

  levelIntervalMs: 50,
};

/** What the detector runs with: the hand-written defaults, overridden by the lab's last export. */
export const PARAMS: DetectorParams = { ...DEFAULTS, ...LAB_OVERRIDES };

/** Window sizes are written for 48 kHz; a 96 kHz interface needs twice the samples. */
export function scaledSamples(samplesAt48k: number, sampleRate: number): number {
  const scaled = (samplesAt48k * sampleRate) / 48000;
  // Kept to a power of two so every window size is a valid FFT size too.
  return Math.pow(2, Math.round(Math.log2(scaled)));
}
