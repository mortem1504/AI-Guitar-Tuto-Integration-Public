/**
 * Single-note exercises: the third kind of lesson, next to `shapes` and
 * `changes`, and the one that needs no camera.
 *
 * An exercise is a list of steps, each a string, a fret, the MIDI note that
 * position gives, and the beat it falls on, plus a tempo. The MIDI number is
 * stored rather than recomputed because the judge compares against it, and a
 * step whose position and note disagreed would be a lesson that marks a right
 * answer wrong: `exerciseProblems()` checks that they agree.
 *
 * The six seeds are the ones on the project slides, ordered easiest first:
 * open strings (no fretting at all), one string, four fingers on every string,
 * then three things that sound like music.
 */

import type { TranslationKey } from "../i18n";
import { noteAt } from "../guitar/tuning";

export interface NoteStep {
  /** 1 is the thin E, 6 the thick E. */
  string: number;
  /** 0 is the open string. */
  fret: number;
  midi: number;
  /** When it is due, in beats from the first note. */
  beat: number;
}

export interface NoteExercise {
  id: string;
  /** Beats per minute in play-through mode. */
  tempo: number;
  steps: NoteStep[];
}

export function step(string: number, fret: number, beat: number): NoteStep {
  return { string, fret, midi: noteAt(string, fret), beat };
}

/** Positions played one per beat, starting on beat 0. */
function evenly(positions: [string: number, fret: number][], beats = 1): NoteStep[] {
  return positions.map(([string, fret], index) => step(string, fret, index * beats));
}

/** Up the list and back down, without repeating the top note. */
function upAndDown(positions: [number, number][]): [number, number][] {
  return [...positions, ...positions.slice(0, -1).reverse()];
}

const OPEN_ROLL_CALL = upAndDown([
  [6, 0],
  [5, 0],
  [4, 0],
  [3, 0],
  [2, 0],
  [1, 0],
]);

const HIGH_E_FIVE = upAndDown([0, 1, 2, 3, 4, 5].map((fret) => [1, fret] as [number, number]));

/** Frets 1-2-3-4 on every string, thick to thin: one finger per fret. */
const SPIDER: [number, number][] = [6, 5, 4, 3, 2, 1].flatMap((string) =>
  [1, 2, 3, 4].map((fret) => [string, fret] as [number, number]),
);

/** A minor pentatonic, first box, fifth position. */
const PENTATONIC_BOX_1 = upAndDown([
  [6, 5],
  [6, 8],
  [5, 5],
  [5, 7],
  [4, 5],
  [4, 7],
  [3, 5],
  [3, 7],
  [2, 5],
  [2, 8],
  [1, 5],
  [1, 8],
]);

/** G major, open position, G2 to G3. */
const G_MAJOR_OPEN = upAndDown([
  [6, 3],
  [5, 0],
  [5, 2],
  [5, 3],
  [4, 0],
  [4, 2],
  [4, 4],
  [3, 0],
]);

/**
 * Beethoven's "Ode to Joy" (public domain), first phrase, on the top two
 * strings: E E F G G F E D C C D E E. D D. A melody everyone can hear go
 * wrong, which is what makes it a good test of the ear as well as the hand.
 */
const ODE: [number, number, number][] = [
  // [string, fret, length in beats]
  [1, 0, 1], [1, 0, 1], [1, 1, 1], [1, 3, 1],
  [1, 3, 1], [1, 1, 1], [1, 0, 1], [2, 3, 1],
  [2, 1, 1], [2, 1, 1], [2, 3, 1], [1, 0, 1],
  [1, 0, 1.5], [2, 3, 0.5], [2, 3, 2],
];

function melody(notes: [number, number, number][]): NoteStep[] {
  let beat = 0;
  return notes.map(([string, fret, length]) => {
    const placed = step(string, fret, beat);
    beat += length;
    return placed;
  });
}

// Tempos are a beginner's: 60 bpm is a note a second, the pace at which a
// first-week player can find a fret without looking twice. The faster ones
// are the ones whose positions stay under one hand.
export const NOTE_EXERCISES: NoteExercise[] = [
  { id: "openStrings", tempo: 60, steps: evenly(OPEN_ROLL_CALL) },
  { id: "highE", tempo: 60, steps: evenly(HIGH_E_FIVE) },
  { id: "spider", tempo: 70, steps: evenly(SPIDER) },
  { id: "pentatonic", tempo: 70, steps: evenly(PENTATONIC_BOX_1) },
  { id: "ode", tempo: 80, steps: melody(ODE) },
  { id: "gMajor", tempo: 70, steps: evenly(G_MAJOR_OPEN) },
];

export function exerciseById(id: string): NoteExercise | undefined {
  return NOTE_EXERCISES.find((exercise) => exercise.id === id);
}

export function exerciseTitleKey(id: string): TranslationKey {
  return `notes.ex.${id}.title` as TranslationKey;
}

export function exerciseSubtitleKey(id: string): TranslationKey {
  return `notes.ex.${id}.sub` as TranslationKey;
}

/** Milliseconds between beats. */
export function beatMs(tempo: number): number {
  return 60000 / tempo;
}

/**
 * The steps that went wrong, as an exercise of their own: each distinct
 * position once, in the order it was first missed, one per beat.
 */
export function mistakesExercise(source: NoteExercise, missedIndices: number[]): NoteExercise | null {
  const seen = new Set<string>();
  const positions: [number, number][] = [];
  for (const index of missedIndices) {
    const target = source.steps[index];
    if (!target) continue;
    const key = `${target.string}:${target.fret}`;
    if (seen.has(key)) continue;
    seen.add(key);
    positions.push([target.string, target.fret]);
  }
  if (positions.length === 0) return null;
  return { id: `${source.id}.mistakes`, tempo: source.tempo, steps: evenly(positions) };
}

/** Anything wrong with an exercise's data, as sentences. Empty means it is sound. */
export function exerciseProblems(exercise: NoteExercise): string[] {
  const problems: string[] = [];
  if (exercise.steps.length === 0) problems.push(`${exercise.id}: no steps`);
  if (!(exercise.tempo >= 30 && exercise.tempo <= 240)) problems.push(`${exercise.id}: tempo ${exercise.tempo}`);
  exercise.steps.forEach((s, i) => {
    if (s.string < 1 || s.string > 6 || s.fret < 0 || s.fret > 24) problems.push(`${exercise.id}[${i}]: position ${s.string}/${s.fret}`);
    if (noteAt(s.string, s.fret) !== s.midi) problems.push(`${exercise.id}[${i}]: midi ${s.midi} is not string ${s.string} fret ${s.fret}`);
    if (i > 0 && s.beat <= exercise.steps[i - 1].beat) problems.push(`${exercise.id}[${i}]: beat ${s.beat} not after the previous`);
  });
  return problems;
}
