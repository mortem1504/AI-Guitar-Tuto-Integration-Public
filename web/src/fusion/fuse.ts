/**
 * Which string and fret a heard note came from, using the hand.
 *
 * Audio decides *what* note; this only decides *where*, and only when it can
 * defend the answer. For each place the note can be played (`candidatesFor`),
 * the fingertip reading closest in time to the pluck is searched for a tip on
 * that string, in that fret's box. The nearest one within tolerance wins.
 * An open string wins when no fingertip is pressing that string near the nut
 * and no fretted candidate has a finger on it. Anything else, or a calibration
 * that is not there, or a reading too old to describe the pluck, returns
 * `audio-only`: never a guess.
 *
 * Distances are in neck units: one string spacing across, one fret box along.
 * Pure: `npm run fusion-check` drives it with synthetic hands.
 */

import type { BoardPosition } from "../guitar/geometry";
import { candidatesFor, type Candidate } from "./candidates";

/** One fingertip, already projected onto the board. */
export interface Tip {
  finger: number;
  position: BoardPosition;
  onBoard: boolean;
}

/** All four fingertips at one moment, on the page clock (performance.now()). */
export interface TipFrame {
  atMs: number;
  tips: Tip[];
}

/**
 * A short memory of where the fingertips were, to look up the moment of a
 * pluck after its message arrives (a pitch window, ~60-110 ms, later).
 */
export class TipHistory {
  private frames: TipFrame[] = [];

  /** ~300 ms, the brief's ring buffer: longer than the note's arrival delay, shorter than a fingering change. */
  constructor(private readonly keepMs = 300) {}

  push(frame: TipFrame) {
    this.frames.push(frame);
    const oldest = frame.atMs - this.keepMs * 2;
    while (this.frames.length > 0 && this.frames[0].atMs < oldest) this.frames.shift();
  }

  /** The frame closest to `atMs`, if one is within `keepMs` of it. */
  closest(atMs: number): TipFrame | null {
    let best: TipFrame | null = null;
    for (const frame of this.frames) {
      if (!best || Math.abs(frame.atMs - atMs) < Math.abs(best.atMs - atMs)) best = frame;
    }
    return best && Math.abs(best.atMs - atMs) <= this.keepMs ? best : null;
  }

  clear() {
    this.frames = [];
  }
}

export interface Fused {
  source: "fused" | "audio-only";
  /** Present when fused. */
  string: number | null;
  fret: number | null;
  /** 0 to 1: how far inside the tolerance, and how clear of the runner-up. */
  confidence: number;
  candidates: Candidate[];
}

export interface FuseOptions {
  /** A neck is calibrated and being tracked. */
  calibrated: boolean;
  /** Highest fret this guitar can be played at (GuitarSpec.maxTeachableFret, plus room). */
  maxFret: number;
}

/**
 * How far a fingertip may sit from a candidate and still be taken as playing
 * it: 0.6 neck units. Half a string spacing is the midpoint to the next
 * string; the rest absorbs what FretReader documents, the tip sitting a few
 * mm above the board and seen from an angle. Along the neck the box itself
 * counts as zero, so 0.6 is generous there.
 */
export const FUSE_TOLERANCE = 0.6;

/** A tip within this of a string, between the nut and this fret, is pressing it: the open string is not sounding. */
export const PRESSING_ACROSS = 0.45;
export const NEAR_NUT_FRET = 12;

/**
 * An open string has no finger to see, only the absence of one, so it is
 * weaker evidence than a fingertip sitting on a fret.
 */
export const OPEN_CONFIDENCE = 0.65;

/** Distance from a tip to a fretted candidate: strings across, and fret boxes outside the right one. */
export function distanceTo(tip: BoardPosition, candidate: Candidate): number {
  const across = Math.abs(tip.string - candidate.string);
  // The box for fret f spans wires f-1 to f.
  const along = tip.wire < candidate.fret - 1 ? candidate.fret - 1 - tip.wire : tip.wire > candidate.fret ? tip.wire - candidate.fret : 0;
  return Math.hypot(across, along);
}

function pressing(tips: Tip[], string: number): boolean {
  return tips.some(
    (tip) => tip.onBoard && Math.abs(tip.position.string - string) < PRESSING_ACROSS && tip.position.wire > 0 && tip.position.wire <= NEAR_NUT_FRET,
  );
}

export function fuse(midi: number, frame: TipFrame | null, options: FuseOptions): Fused {
  const candidates = candidatesFor(midi, options.maxFret);
  const audioOnly: Fused = { source: "audio-only", string: null, fret: null, confidence: 0, candidates };
  if (!options.calibrated || !frame) return audioOnly;
  const tips = frame.tips.filter((tip) => tip.onBoard);

  const scored = candidates
    .filter((c) => c.fret > 0)
    .map((candidate) => ({
      candidate,
      distance: Math.min(Infinity, ...tips.map((tip) => distanceTo(tip.position, candidate))),
    }))
    .filter((entry) => entry.distance <= FUSE_TOLERANCE)
    .sort((a, b) => a.distance - b.distance);

  if (scored.length > 0) {
    const [best, second] = scored;
    const inside = 1 - best.distance / FUSE_TOLERANCE;
    // Two candidates both under a finger (rare: different strings, frets
    // apart) is an ambiguity, and confidence says so.
    const clear = second ? Math.min(1, (second.distance - best.distance) / FUSE_TOLERANCE) : 1;
    return {
      source: "fused",
      string: best.candidate.string,
      fret: best.candidate.fret,
      confidence: Math.max(0, Math.min(1, 0.5 + 0.5 * inside * clear)),
      candidates,
    };
  }

  const open = candidates.find((c) => c.fret === 0 && !pressing(tips, c.string));
  if (open) return { source: "fused", string: open.string, fret: 0, confidence: OPEN_CONFIDENCE, candidates };
  return audioOnly;
}
