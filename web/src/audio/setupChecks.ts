/**
 * The setup screen's verdicts (WF-04): input level, room noise, a note test,
 * and the camera's lighting. Pure: the panel feeds them numbers it measured,
 * `npm run home-check` feeds them made-up ones.
 */

import { WEAK_PEAK, WEAK_RMS } from "../lesson/noteJudge";
import { CLIP_PEAK } from "./signalQuality";

export const dbfs = (amplitude: number) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);

export type LevelVerdict = "waiting" | "quiet" | "good" | "clipping";

/**
 * Plucks should peak at least 10 dB over WEAK_PEAK (-40 dBFS, the judge's
 * "too quiet to be a pluck"): -30 dBFS leaves room for a softer note on a
 * thinner string. Anything under WEAK_PEAK is not a pluck yet.
 */
export const GOOD_PEAK = 0.0316;

/** The loudest peak over the last few seconds of playing. */
export function levelVerdict(maxPeak: number): LevelVerdict {
  if (maxPeak >= CLIP_PEAK) return "clipping";
  if (maxPeak < WEAK_PEAK) return "waiting";
  return maxPeak < GOOD_PEAK ? "quiet" : "good";
}

export type NoiseVerdict = "quiet" | "fair" | "noisy";

/**
 * Room noise against the judge. Above WEAK_RMS (-50 dBFS, the quietest pluck
 * still judged) the room itself would read as a note's level, so soft notes
 * drown. Under -60 dBFS there is 10 dB of room to spare.
 */
export const QUIET_ROOM_RMS = 0.001;

/** The median RMS of a few seconds of silence: the median, so a cough does not decide. */
export function noiseVerdict(rmsReadings: readonly number[]): { verdict: NoiseVerdict; rms: number } | null {
  if (rmsReadings.length === 0) return null;
  const sorted = [...rmsReadings].sort((a, b) => a - b);
  const rms = sorted[Math.floor(sorted.length / 2)];
  const verdict = rms < QUIET_ROOM_RMS ? "quiet" : rms < WEAK_RMS ? "fair" : "noisy";
  return { verdict, rms };
}

export type NoteTestVerdict = "ok" | "octave" | "off";

/** The open A string, A2: the middle of the guitar's range, easy to pick on its own. */
export const NOTE_TEST_MIDI = 45;

export function noteTestVerdict(heard: number, expected = NOTE_TEST_MIDI): NoteTestVerdict {
  if (heard === expected) return "ok";
  return heard !== expected && (heard - expected) % 12 === 0 ? "octave" : "off";
}

export type LightVerdict = "dark" | "ok" | "bright";

/**
 * Mean luma of the camera picture, 0 to 1. A webcam's auto-exposure aims at
 * mid grey (~0.45); under 0.25 it has run out of exposure and the hand model
 * starts losing fingertips in the noise, over 0.8 the picture is washed out
 * (usually a window behind the student). First guesses, not yet measured on
 * this project's webcams: Phase 6 says so.
 */
export const DARK_LUMA = 0.25;
export const BRIGHT_LUMA = 0.8;

export function lightVerdict(meanLuma: number): LightVerdict {
  if (meanLuma < DARK_LUMA) return "dark";
  return meanLuma > BRIGHT_LUMA ? "bright" : "ok";
}
