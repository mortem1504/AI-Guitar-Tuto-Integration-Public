/**
 * What the student has already done.
 *
 * Small on purpose: whether a lesson has been finished, the best score on it,
 * and the longest streak. That is enough to unlock the next lesson and to show
 * someone that last week happened, and it is little enough that losing it costs
 * nothing real — the guitar remembers the rest.
 *
 * Hostile input, like every other stored value here: unknown lesson ids are
 * dropped, numbers are clamped, and a corrupt file reads as a blank slate
 * rather than throwing on the way in.
 */

import { LESSONS } from "./curriculum";

const STORAGE_KEY = "guitar.progress.v1";

export interface LessonRecord {
  done: boolean;
  /** Chords passed on the first attempt, best run. */
  best: number;
  /** Longest run of chords passed without a mistake. */
  streak: number;
}

export type Progress = Record<string, LessonRecord>;

const KNOWN_IDS = new Set(LESSONS.map((lesson) => lesson.id));

export function emptyProgress(): Progress {
  return {};
}

function clampCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(9999, Math.max(0, Math.round(value)));
}

export function loadProgress(): Progress {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return emptyProgress();
  }
  if (!raw) return emptyProgress();

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return emptyProgress();
  }
  if (typeof stored !== "object" || stored === null) return emptyProgress();

  const progress: Progress = {};
  for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!KNOWN_IDS.has(id)) continue;
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    progress[id] = {
      done: record.done === true,
      best: clampCount(record.best),
      streak: clampCount(record.streak),
    };
  }
  return progress;
}

export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Private browsing or a full quota. The lesson still runs.
  }
}

/** Records a finished lesson, keeping the best figures rather than the last. */
export function recordResult(progress: Progress, id: string, firstTry: number, streak: number): Progress {
  const previous = progress[id];
  const updated: Progress = {
    ...progress,
    [id]: {
      done: true,
      best: Math.max(previous?.best ?? 0, firstTry),
      streak: Math.max(previous?.streak ?? 0, streak),
    },
  };
  saveProgress(updated);
  return updated;
}

/**
 * Whether a lesson can be started.
 *
 * Locking is a nudge, not a gate on knowledge: the free-practice mode reaches
 * every chord in the library from the first minute. What the lock buys is an
 * order for someone who does not yet know what to practise next.
 */
export function isUnlocked(progress: Progress, requires: string | null): boolean {
  if (!requires) return true;
  return progress[requires]?.done === true;
}
