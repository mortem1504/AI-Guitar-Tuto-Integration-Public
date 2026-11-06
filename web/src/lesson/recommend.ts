/**
 * What to practise next, by simple rules a teacher would say out loud.
 *
 * Every exercise starts from a score for the student's level (an easy-first
 * order for a beginner, harder first for a regular player), gains points for
 * matching the goal and the favourite style, gains one when the last attempt
 * went badly (worth another go), and drops below everything once it is
 * mastered. Each recommendation carries the one reason that moved it most, so
 * the dashboard can say *why*. No model and no data leave the browser.
 *
 * Pure: `npm run home-check` runs it over made-up histories.
 */

import { NOTE_EXERCISES, type NoteExercise } from "./exercises";
import type { Goal, Level, Profile, Style } from "./profile";
import type { SessionRecord } from "./sessionStore";

export type Reason = "start" | "level" | "goal" | "style" | "retry" | "fresh" | "mastered";

export interface Recommendation {
  exerciseId: string;
  reason: Reason;
  score: number;
  /** Best accuracy so far (full runs only), when there is one. */
  best: number | null;
}

/**
 * Mastered: two full runs at 90% or better. 90% is the accuracy a teacher
 * would accept before moving on (one slip in ten); twice, so one lucky run
 * does not retire an exercise.
 */
export const MASTERED_ACCURACY = 0.9;
export const MASTERED_RUNS = 2;
/** Below this on the last run, the exercise is worth repeating soon. */
export const RETRY_BELOW = 0.7;

/**
 * Easy to hard per level, from the exercises' content: open strings need no
 * fretting, one string comes next, then melodies, then scales across strings,
 * then the four-finger spider.
 */
const ORDER: Record<Level, string[]> = {
  new: ["openStrings", "highE", "ode", "gMajor", "pentatonic", "spider"],
  some: ["highE", "ode", "gMajor", "spider", "pentatonic", "openStrings"],
  regular: ["spider", "pentatonic", "gMajor", "ode", "highE", "openStrings"],
};

const GOAL_BONUS: Record<Goal, string[]> = {
  melodies: ["ode", "highE"],
  chords: ["openStrings", "gMajor"],
  solos: ["pentatonic", "spider"],
  songs: ["ode", "pentatonic"],
};

const STYLE_BONUS: Record<Style, string[]> = {
  rock: ["pentatonic"],
  blues: ["pentatonic"],
  pop: ["gMajor"],
  folk: ["gMajor", "ode"],
  classical: ["ode", "spider"],
};

/** Full runs of an exercise, newest first (records come newest first). */
function runsOf(records: readonly SessionRecord[], id: string): SessionRecord[] {
  return records.filter((r) => r.exerciseId === id && !r.mistakesOnly && r.attempted > 0);
}

export function isMastered(records: readonly SessionRecord[], id: string): boolean {
  return runsOf(records, id).filter((r) => r.accuracy >= MASTERED_ACCURACY).length >= MASTERED_RUNS;
}

export function recommend(
  profile: Profile | null,
  records: readonly SessionRecord[],
  exercises: readonly NoteExercise[] = NOTE_EXERCISES,
): Recommendation[] {
  const level = profile?.level ?? "new";
  const order = ORDER[level];
  const scored = exercises.map((exercise, position) => {
    const id = exercise.id;
    const runs = runsOf(records, id);
    const rank = order.indexOf(id);
    // Level gives 0-5 (first in the order gets 5); anything unlisted sits last.
    let score = rank < 0 ? 0 : order.length - 1 - rank;
    let reason: Reason = rank === 0 ? "start" : "level";
    let lift = 0;
    const boost = (points: number, why: Reason) => {
      score += points;
      if (points > lift) {
        lift = points;
        reason = why;
      }
    };
    if (profile && GOAL_BONUS[profile.goal].includes(id)) boost(3, "goal");
    if (profile && STYLE_BONUS[profile.style].includes(id)) boost(2, "style");
    // Above goal and style together (3 + 2): a note that went badly last time
    // is what a teacher would come back to first.
    if (runs.length > 0 && runs[0].accuracy < RETRY_BELOW) boost(5.5, "retry");
    if (runs.length === 0 && records.length > 0 && rank >= 0 && rank <= 2) boost(1, "fresh");
    const mastered = isMastered(records, id);
    if (mastered) {
      score -= 100;
      reason = "mastered";
    }
    const best = runs.length > 0 ? Math.max(...runs.map((r) => r.accuracy)) : null;
    return { exerciseId: id, reason, score, best, position };
  });
  // Ties keep the exercises' own order, so the list never shuffles for nothing.
  scored.sort((a, b) => b.score - a.score || a.position - b.position);
  return scored.map(({ position: _position, ...rest }) => rest);
}

/** The exercise to offer under "Continue": the newest session's, unless it was finished well. */
export function continueWith(records: readonly SessionRecord[]): { exerciseId: string; accuracy: number; mistakesOnly: boolean } | null {
  const last = records[0];
  if (!last) return null;
  return { exerciseId: last.exerciseId, accuracy: last.accuracy, mistakesOnly: last.mistakesOnly };
}

/**
 * Accuracy over the last `count` sessions that had notes in them, oldest
 * first: what the dashboard's trend bars draw. `change` compares the mean of
 * the newer half with the older half, so one bad day does not read as a slump.
 */
export function accuracyTrend(records: readonly SessionRecord[], count = 12): { points: number[]; change: number | null } {
  const points = records
    .filter((r) => r.attempted > 0)
    .slice(0, count)
    .map((r) => r.accuracy)
    .reverse();
  if (points.length < 4) return { points, change: null };
  const half = Math.floor(points.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { points, change: mean(points.slice(-half)) - mean(points.slice(0, half)) };
}
