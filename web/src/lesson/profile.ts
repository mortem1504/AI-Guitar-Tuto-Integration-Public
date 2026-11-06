/**
 * Who is practising: the three answers of the onboarding survey.
 *
 * Asked once, on the first visit, and skippable; changeable from the
 * dashboard. It only orders recommendations (`recommend.ts`), by plain rules:
 * no model, nothing sent anywhere. Stored in localStorage and, like every
 * other stored value here, read back as hostile input: an unknown answer is
 * dropped, a corrupt entry reads as "not answered".
 */

const STORAGE_KEY = "guitar.profile.v1";

export const LEVELS = ["new", "some", "regular"] as const;
export const GOALS = ["melodies", "chords", "solos", "songs"] as const;
export const STYLES = ["rock", "pop", "folk", "blues", "classical"] as const;

export type Level = (typeof LEVELS)[number];
export type Goal = (typeof GOALS)[number];
export type Style = (typeof STYLES)[number];

export interface Profile {
  level: Level;
  goal: Goal;
  style: Style;
}

function pick<T extends string>(options: readonly T[], value: unknown): T | null {
  return options.find((option) => option === value) ?? null;
}

export function parseProfile(stored: unknown): Profile | null {
  if (typeof stored !== "object" || stored === null) return null;
  const data = stored as Record<string, unknown>;
  const level = pick(LEVELS, data.level);
  const goal = pick(GOALS, data.goal);
  const style = pick(STYLES, data.style);
  return level && goal && style ? { level, goal, style } : null;
}

/** Null when never answered, skipped, or unreadable. */
export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode or full: the survey is asked again next time, nothing worse.
  }
}

/** "Skip" is remembered for the session only, so the survey is not forced on anyone. */
let skipped = false;
export const skipSurvey = () => (skipped = true);
export const surveySkipped = () => skipped;
