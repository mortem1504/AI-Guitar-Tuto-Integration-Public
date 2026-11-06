/**
 * Judging a note when the exercise says what it should be.
 *
 * The detector does not know what the student was asked to play; a lesson
 * does. When the heard note is exactly an octave (12), two octaves (24) or an
 * octave and a fifth (19, the third harmonic) away from the target, and the
 * detector was not sure of it, the likeliest story is the detector's harmonic
 * mistake, not the student's: nobody aiming at E3 plays B4 by accident.
 *
 * This is a bias, and biases cost something: a student who really does play
 * the wrong octave, unsure-sounding, is told they were right. That is why the
 * rule is narrow (exact intervals only, low confidence only), why every firing
 * is reported, and why the lab measures how often it accepts a wrong note
 * (`lab/evaluate.py`, false accepts against shifted targets).
 *
 * Pure. Used by the lesson judge from Phase 3 on.
 */

import type { DetectorParams } from "./params";

/** Harmonic confusions the rule forgives, in semitones from the target. */
const HARMONIC_INTERVALS = [12, 19, 24];

export interface Reconciled {
  midi: number;
  /** True when the prior changed the answer. Every firing should be logged. */
  fired: boolean;
}

export function reconcileWithTarget(
  midi: number,
  confidence: number,
  target: number,
  params: Pick<DetectorParams, "priorMaxConfidence">,
): Reconciled {
  const distance = Math.abs(midi - target);
  if (HARMONIC_INTERVALS.includes(distance) && confidence < params.priorMaxConfidence) {
    return { midi: target, fired: true };
  }
  return { midi, fired: false };
}
