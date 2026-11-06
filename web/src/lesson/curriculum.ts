/**
 * The course.
 *
 * Ordered the way a teacher orders it, which is not the way a music theorist
 * would. Em comes first because it is two fingers on adjacent strings and
 * nothing has to stretch; C comes late because it does; the barre is last
 * because it is the wall, and arriving at it with four working chords is the
 * difference between a hard week and quitting.
 *
 * Two kinds of lesson, and the difference is the whole point of the second one:
 *
 *   - **shapes** — one chord at a time, held until it is right. Learning where
 *     the fingers go.
 *   - **changes** — the same few chords over and over, in a cycle. Learning to
 *     *get* there, which is the part that actually takes months and the part a
 *     chord diagram cannot teach.
 */

import type { TranslationKey } from "../i18n";

export type LessonKind = "shapes" | "changes";

export interface Lesson {
  id: string;
  kind: LessonKind;
  /** Chord ids from the library, in teaching order. */
  chords: string[];
  /** How many times the sequence is played through. */
  rounds: number;
  /** Which lesson has to be finished first. Null for the opening one. */
  requires: string | null;
}

export const LESSONS: Lesson[] = [
  {
    id: "first",
    kind: "shapes",
    chords: ["Em", "Em7", "Am7", "E7"],
    rounds: 2,
    requires: null,
  },
  {
    id: "minors",
    kind: "shapes",
    chords: ["Em", "Am", "Dm"],
    rounds: 2,
    requires: "first",
  },
  {
    id: "majors",
    kind: "shapes",
    chords: ["E", "A", "D", "G", "C"],
    rounds: 2,
    requires: "minors",
  },
  {
    id: "changes",
    kind: "changes",
    chords: ["Am", "Em"],
    rounds: 4,
    requires: "majors",
  },
  {
    id: "sevenths",
    kind: "shapes",
    chords: ["E7", "A7", "D7", "G7", "C7"],
    rounds: 2,
    requires: "changes",
  },
  {
    id: "progression",
    kind: "changes",
    chords: ["C", "G", "Am", "Em"],
    rounds: 3,
    requires: "sevenths",
  },
  {
    id: "colour",
    kind: "shapes",
    chords: ["Cmaj7", "Amaj7", "Dsus2", "Dsus4", "Asus2", "Cadd9"],
    rounds: 1,
    requires: "progression",
  },
  {
    id: "barre",
    kind: "shapes",
    chords: ["Fmaj7", "F", "Fm", "Bm"],
    rounds: 2,
    requires: "colour",
  },
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

/** The full sequence a lesson asks for: its chords, repeated. */
export function sequenceOf(lesson: Lesson): string[] {
  const sequence: string[] = [];
  for (let round = 0; round < lesson.rounds; round++) sequence.push(...lesson.chords);
  return sequence;
}

/** Its name and one line about it, as dictionary keys. */
export function titleKey(lesson: Lesson): TranslationKey {
  return `course.${lesson.id}.title` as TranslationKey;
}

export function subtitleKey(lesson: Lesson): TranslationKey {
  return `course.${lesson.id}.sub` as TranslationKey;
}
