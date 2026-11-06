/**
 * One note, judged: the six feedback states on the project slides.
 *
 *   clean       the right note (and, in play-through, on time)
 *   wrongNote   another note: what was played, what was wanted, which way to go
 *   wrongSpot   the right pitch at another string/fret. Needs the camera, so it
 *               is only ever given by Phase 4's fusion, never by audio alone
 *   timing      the right note outside the timing window, with how far out
 *   notCaught   nothing anyone would trust was heard. Not a mistake
 *   weakSignal  what reached the input was too quiet to judge. Not a mistake
 *
 * Pure, so `npm run lesson-check` can run every branch. What it says to the
 * student is decided in `feedbackLine` (ui), from the verdict's fields.
 */

import type { NoteStep } from "./exercises";

/** Where vision says the note was played (Phase 4's fusion), when it could say. */
export interface Place {
  source: "fused" | "audio-only";
  string: number | null;
  fret: number | null;
  confidence: number;
}

export type FeedbackState = "clean" | "wrongNote" | "wrongSpot" | "timing" | "notCaught" | "weakSignal";

/** What the listener heard for a step, if anything. Times in ms on the audio clock. */
export type Attempt =
  | { kind: "note"; midi: number; onsetMs: number; rms: number; confidence: number; place?: Place }
  | { kind: "unclear"; onsetMs: number; rms: number }
  /** Nothing at all, with the loudest input peak seen while waiting. */
  | { kind: "none"; peak: number };

export interface NoteVerdict {
  state: FeedbackState;
  target: NoteStep;
  /** The MIDI note heard, when one was. */
  played: number | null;
  /** Onset minus the beat, in ms; negative is early. Null when untimed. */
  offsetMs: number | null;
  /** Mistakes count against accuracy; notCaught and weakSignal do not. */
  counts: boolean;
  /** Where the string/fret came from: the camera agreed with a position, or not. */
  source: "audio-only" | "fused";
  /** The position vision saw, when fused. */
  place: { string: number; fret: number; confidence: number } | null;
}

export interface JudgeOptions {
  /** When the note was due, or null in loop mode, which has no clock. */
  dueMs: number | null;
  /** ± this far from the beat is on time. */
  windowMs: number;
}

/**
 * Too quiet to judge. A peak under -40 dBFS is the same cut the lab's recorder
 * uses for "too quiet to be a plucked note on any input" (lab/record_dataset.py,
 * QUIET_PEAK). A pluck's RMS over the pitch window sits about 10 dB under its
 * peak on the synthetic plucks, hence -50 dBFS for RMS. Neither has been
 * measured against real quiet playing yet.
 */
export const WEAK_PEAK = 0.01;
export const WEAK_RMS = 0.003;

/**
 * Vision has to be at least this sure before "right note, wrong spot" is said.
 * Below it, a disagreeing camera is ignored and the note is judged by ear: the
 * brief's rule, never mark a note wrong because vision disagrees with low
 * confidence. 0.75 is fuse()'s confidence for a fingertip within 0.3 neck
 * units (half its tolerance) of the position with no runner-up; an open
 * string, judged only by the absence of a finger (0.65), never qualifies.
 */
export const WRONG_SPOT_CONFIDENCE = 0.75;

/**
 * The on-time window. ±150 ms is generous on purpose: at 60 bpm that is
 * 15% of a beat, the slack a first-month player needs, and narrower than the
 * gap to any neighbouring note in the seed exercises (500 ms at the fastest).
 * Never more than a quarter of the beat, so a fast exercise stays fair.
 */
export function timingWindowMs(beatMs: number): number {
  return Math.min(150, beatMs / 4);
}

export function judgeNote(target: NoteStep, attempt: Attempt, options: JudgeOptions): NoteVerdict {
  const base = { target, played: null, offsetMs: null, counts: false, source: "audio-only" as const, place: null };
  switch (attempt.kind) {
    case "none":
      return { ...base, state: attempt.peak < WEAK_PEAK ? "weakSignal" : "notCaught" };
    case "unclear":
      return { ...base, state: attempt.rms < WEAK_RMS ? "weakSignal" : "notCaught" };
    case "note": {
      const offsetMs = options.dueMs === null ? null : attempt.onsetMs - options.dueMs;
      const played = attempt.midi;
      const seen = attempt.place;
      const place =
        seen?.source === "fused" && seen.string !== null && seen.fret !== null
          ? { string: seen.string, fret: seen.fret, confidence: seen.confidence }
          : null;
      const heard = { ...base, played, offsetMs, counts: true, source: place ? ("fused" as const) : ("audio-only" as const), place };
      if (played !== target.midi) return { ...heard, state: "wrongNote" };
      if (place && place.confidence >= WRONG_SPOT_CONFIDENCE && (place.string !== target.string || place.fret !== target.fret)) {
        return { ...heard, state: "wrongSpot" };
      }
      if (offsetMs !== null && Math.abs(offsetMs) > options.windowMs) return { ...heard, state: "timing" };
      return { ...heard, state: "clean" };
    }
  }
}

/**
 * How to get from what was played to the target on the target's string, in
 * frets: positive is towards the body (up), negative towards the nut (back).
 * Null when it cannot be reached on that string that way (more than five frets,
 * or below the open string), where naming the position is more useful.
 */
export function fretMove(played: number, target: NoteStep): number | null {
  const move = target.midi - played;
  const from = target.fret - move;
  if (move === 0 || Math.abs(move) > 5 || from < 0) return null;
  return move;
}

/** Is it the same note an octave (or two) away: the classic wrong-octave mistake. */
export function octavesAway(played: number, target: number): number {
  const distance = played - target;
  return distance !== 0 && distance % 12 === 0 ? distance / 12 : 0;
}
