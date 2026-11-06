/**
 * A scripted performance of an exercise, mistakes included, for
 * `?debug&source=exercise`: the whole lesson, judge and review can then be
 * run in a browser with no guitar, and the result is known in advance.
 *
 * The mistakes are fixed, so a run can be checked against them: every 5th
 * note (from the 4th) a semitone sharp, in play-through every 7th (from the
 * 6th) 220 ms late and every 11th (from the 10th) not played at all.
 */

import { beatMs, type NoteExercise } from "./exercises";
import type { PracticeMode } from "./NoteSession";
import { COUNT_IN_BEATS } from "./NoteSession";

export interface DemoNote {
  midi: number;
  /** Ms from the session's start (the first count-in beat). */
  atMs: number;
}

export function demoPerformance(exercise: NoteExercise, mode: PracticeMode): DemoNote[] {
  const beat = beatMs(exercise.tempo);
  const first = COUNT_IN_BEATS * beat;
  const notes: DemoNote[] = [];
  if (mode === "playThrough") {
    exercise.steps.forEach((step, i) => {
      if (i % 11 === 9) return;
      const late = i % 7 === 5 ? 220 : 15;
      notes.push({ midi: i % 5 === 3 ? step.midi + 1 : step.midi, atMs: first + step.beat * beat + late });
    });
    return notes;
  }
  let at = first + 400;
  exercise.steps.forEach((step, i) => {
    if (i % 5 === 3) {
      notes.push({ midi: step.midi + 1, atMs: at });
      at += 1300;
    }
    notes.push({ midi: step.midi, atMs: at });
    at += 1100;
  });
  return notes;
}
