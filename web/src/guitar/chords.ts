/**
 * The chord library: not which notes a chord contains, but where the fingers go.
 *
 * This is the difference between music theory and a guitar lesson. "A minor is
 * A, C and E" helps nobody hold one. What a student needs is: index on the
 * second string at the first fret, middle on the fourth at the second, ring on
 * the third at the second, and do not play the thick E.
 *
 * Shapes are written the way tabs and chord boxes write them — six entries,
 * from the thick E to the thin E — because that is the notation every other
 * source the student will ever read uses, and a library that disagrees with
 * every book is a library nobody can check.
 */

import type { ChordQuality } from "../song/parse";
import type { GuitarSpec } from "./geometry";
import { pitchClass } from "./tuning";

/** A fret entry: a number is a fret (0 is open), `null` means "do not play". */
type FretEntry = number | null;

/** Which finger presses a string. 1 index, 4 pinky; `null` for open or muted. */
type FingerEntry = 1 | 2 | 3 | 4 | null;

export interface Barre {
  finger: 1 | 2 | 3 | 4;
  fret: number;
  /** Inclusive range of string numbers the finger lies across. */
  fromString: number;
  toString: number;
}

export interface ChordShape {
  /** Stable id, also what a song chart matches against: "Am", "Cmaj7". */
  id: string;
  /** How it is written on screen. */
  name: string;
  root: number;
  quality: ChordQuality;
  /** Six frets, thick E first. */
  frets: [FretEntry, FretEntry, FretEntry, FretEntry, FretEntry, FretEntry];
  /** Six fingers, thick E first, aligned with `frets`. */
  fingers: [FingerEntry, FingerEntry, FingerEntry, FingerEntry, FingerEntry, FingerEntry];
  barre?: Barre;
  /** 1 is a first-day chord; 5 is a barre chord that takes weeks. */
  difficulty: 1 | 2 | 3 | 4 | 5;
}

/** One finger, in the numbering the rest of the app uses. */
export interface Placement {
  finger: 1 | 2 | 3 | 4;
  /** 1 is the thin E. */
  string: number;
  fret: number;
  /** True when this string is part of a barre rather than a fingertip. */
  underBarre?: boolean;
}

/**
 * A chord as the class works with it: the fingers that have to be placed, the
 * strings that ring open, and the strings that must stay quiet.
 */
export interface ChordTarget {
  shape: ChordShape;
  /** One entry per fingertip that has to land somewhere. */
  placements: Placement[];
  /** String numbers that ring open. */
  open: number[];
  /** String numbers that must not sound. */
  muted: number[];
  barre?: Barre;
}

/** `frets` is written thick-E-first; string numbers run the other way. */
function stringNumberAt(index: number): number {
  return 6 - index;
}

function shape(
  id: string,
  name: string,
  root: number,
  quality: ChordQuality,
  frets: ChordShape["frets"],
  fingers: ChordShape["fingers"],
  difficulty: ChordShape["difficulty"],
  barre?: Barre,
): ChordShape {
  return { id, name, root, quality, frets, fingers, difficulty, barre };
}

const X = null;

/**
 * The shapes worth teaching, roughly in the order a beginner meets them.
 *
 * Deliberately not exhaustive. Every entry here is a shape a real teacher
 * gives a real beginner; anything more exotic is better skipped than taught
 * badly, and the song loader already says out loud when a chart asks for
 * something the library does not have.
 */
export const CHORD_SHAPES: ChordShape[] = [
  // --- The first handful: two and three fingers, nothing to stretch. ---
  shape("Em", "Em", 4, "min", [0, 2, 2, 0, 0, 0], [null, 2, 3, null, null, null], 1),
  shape("Em7", "Em7", 4, "min7", [0, 2, 0, 0, 0, 0], [null, 2, null, null, null, null], 1),
  shape("Am", "Am", 9, "min", [X, 0, 2, 2, 1, 0], [null, null, 2, 3, 1, null], 2),
  shape("Am7", "Am7", 9, "min7", [X, 0, 2, 0, 1, 0], [null, null, 2, null, 1, null], 1),
  shape("E", "E", 4, "maj", [0, 2, 2, 1, 0, 0], [null, 2, 3, 1, null, null], 2),
  shape("E7", "E7", 4, "dom7", [0, 2, 0, 1, 0, 0], [null, 2, null, 1, null, null], 1),
  shape("A", "A", 9, "maj", [X, 0, 2, 2, 2, 0], [null, null, 1, 2, 3, null], 2),
  shape("A7", "A7", 9, "dom7", [X, 0, 2, 0, 2, 0], [null, null, 1, null, 3, null], 1),
  shape("D", "D", 2, "maj", [X, X, 0, 2, 3, 2], [null, null, null, 1, 3, 2], 2),
  shape("Dm", "Dm", 2, "min", [X, X, 0, 2, 3, 1], [null, null, null, 2, 3, 1], 2),
  shape("D7", "D7", 2, "dom7", [X, X, 0, 2, 1, 2], [null, null, null, 2, 1, 3], 2),
  shape("G", "G", 7, "maj", [3, 2, 0, 0, 0, 3], [2, 1, null, null, null, 3], 2),
  shape("G7", "G7", 7, "dom7", [3, 2, 0, 0, 0, 1], [3, 2, null, null, null, 1], 2),
  shape("C", "C", 0, "maj", [X, 3, 2, 0, 1, 0], [null, 3, 2, null, 1, null], 2),
  shape("C7", "C7", 0, "dom7", [X, 3, 2, 3, 1, 0], [null, 3, 2, 4, 1, null], 3),
  shape("Cmaj7", "Cmaj7", 0, "maj7", [X, 3, 2, 0, 0, 0], [null, 3, 2, null, null, null], 1),
  shape("Amaj7", "Amaj7", 9, "maj7", [X, 0, 2, 1, 2, 0], [null, null, 3, 1, 2, null], 2),
  shape("Dmaj7", "Dmaj7", 2, "maj7", [X, X, 0, 2, 2, 2], [null, null, null, 1, 1, 1], 3, {
    finger: 1,
    fret: 2,
    fromString: 1,
    toString: 3,
  }),
  shape("Fmaj7", "Fmaj7", 5, "maj7", [X, X, 3, 2, 1, 0], [null, null, 3, 2, 1, null], 2),
  shape("Dm7", "Dm7", 2, "min7", [X, X, 0, 2, 1, 1], [null, null, null, 2, 1, 1], 3, {
    finger: 1,
    fret: 1,
    fromString: 1,
    toString: 2,
  }),

  // --- Colour, still open. ---
  shape("Dsus2", "Dsus2", 2, "sus2", [X, X, 0, 2, 3, 0], [null, null, null, 1, 3, null], 2),
  shape("Dsus4", "Dsus4", 2, "sus4", [X, X, 0, 2, 3, 3], [null, null, null, 1, 2, 3], 3),
  shape("Asus2", "Asus2", 9, "sus2", [X, 0, 2, 2, 0, 0], [null, null, 1, 2, null, null], 2),
  shape("Asus4", "Asus4", 9, "sus4", [X, 0, 2, 2, 3, 0], [null, null, 1, 2, 3, null], 2),
  shape("Esus4", "Esus4", 4, "sus4", [0, 2, 2, 2, 0, 0], [null, 1, 2, 3, null, null], 2),
  shape("C6", "C6", 0, "maj6", [X, 3, 2, 2, 1, 0], [null, 4, 2, 3, 1, null], 3),
  shape("Am6", "Am6", 9, "min6", [X, 0, 2, 2, 1, 2], [null, null, 2, 3, 1, 4], 3),
  shape("Cadd9", "Cadd9", 0, "maj", [X, 3, 2, 0, 3, 3], [null, 2, 1, null, 3, 4], 3),
  shape("B7", "B7", 11, "dom7", [X, 2, 1, 2, 0, 2], [null, 2, 1, 3, null, 4], 3),
  shape("Am9", "Am9", 9, "min9", [X, 0, 2, 4, 1, 0], [null, null, 2, 4, 1, null], 3),

  // --- Barre chords: the wall every beginner hits. ---
  shape("F", "F", 5, "maj", [1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1], 5, {
    finger: 1,
    fret: 1,
    fromString: 1,
    toString: 6,
  }),
  shape("Fm", "Fm", 5, "min", [1, 3, 3, 1, 1, 1], [1, 3, 4, 1, 1, 1], 5, {
    finger: 1,
    fret: 1,
    fromString: 1,
    toString: 6,
  }),
  shape("Bm", "Bm", 11, "min", [X, 2, 4, 4, 3, 2], [null, 1, 3, 4, 2, 1], 4, {
    finger: 1,
    fret: 2,
    fromString: 1,
    toString: 5,
  }),
  shape("B", "B", 11, "maj", [X, 2, 4, 4, 4, 2], [null, 1, 2, 3, 4, 1], 5, {
    finger: 1,
    fret: 2,
    fromString: 1,
    toString: 5,
  }),
  shape("Bb", "Bb", 10, "maj", [X, 1, 3, 3, 3, 1], [null, 1, 2, 3, 4, 1], 5, {
    finger: 1,
    fret: 1,
    fromString: 1,
    toString: 5,
  }),
  shape("F#m", "F#m", 6, "min", [2, 4, 4, 2, 2, 2], [1, 3, 4, 1, 1, 1], 5, {
    finger: 1,
    fret: 2,
    fromString: 1,
    toString: 6,
  }),
  shape("Cm", "Cm", 0, "min", [X, 3, 5, 5, 4, 3], [null, 1, 3, 4, 2, 1], 5, {
    finger: 1,
    fret: 3,
    fromString: 1,
    toString: 5,
  }),
  shape("Bm7", "Bm7", 11, "min7", [X, 2, 4, 2, 3, 2], [null, 1, 3, 1, 2, 1], 4, {
    finger: 1,
    fret: 2,
    fromString: 1,
    toString: 5,
  }),
  shape("F#m7", "F#m7", 6, "min7", [2, 4, 2, 2, 2, 2], [1, 3, 1, 1, 1, 1], 4, {
    finger: 1,
    fret: 2,
    fromString: 1,
    toString: 6,
  }),
];

const BY_ID = new Map(CHORD_SHAPES.map((entry) => [entry.id, entry]));

export function chordById(id: string): ChordShape | undefined {
  return BY_ID.get(id);
}

/**
 * The shape for a chord a chart asked for, or nothing.
 *
 * Matching on root and quality rather than on the written token means "A-",
 * "Amin" and "Am" all land on the same shape, which is the parser's job done
 * properly rather than a second spelling table here.
 */
export function findShape(root: number, quality: ChordQuality): ChordShape | undefined {
  const wanted = pitchClass(root);
  return CHORD_SHAPES.find((entry) => entry.root === wanted && entry.quality === quality);
}

/** Every shape a given guitar can reasonably be asked for. */
export function shapesFor(spec: GuitarSpec): ChordShape[] {
  return CHORD_SHAPES.filter((entry) => highestFret(entry) <= spec.maxTeachableFret);
}

export function highestFret(entry: ChordShape): number {
  return entry.frets.reduce<number>((top, fret) => Math.max(top, fret ?? 0), 0);
}

/** How far up the neck the shape starts, so a diagram can be drawn from there. */
export function lowestFret(entry: ChordShape): number {
  const pressed = entry.frets.filter((fret): fret is number => fret !== null && fret > 0);
  return pressed.length === 0 ? 0 : Math.min(...pressed);
}

/**
 * Turns a shape into the thing the class actually checks: a list of fingertips
 * with a place to be.
 *
 * A barre collapses into one placement, on the outermost string it covers. A
 * barre is one finger doing one thing, and asking the camera to confirm six
 * separate contact points under a single finger would fail constantly on a
 * shape that is, in fact, correct.
 */
export function targetOf(entry: ChordShape): ChordTarget {
  const placements: Placement[] = [];
  const open: number[] = [];
  const muted: number[] = [];
  const seenBarre = new Set<number>();

  entry.frets.forEach((fret, index) => {
    const stringNumber = stringNumberAt(index);
    if (fret === null) {
      muted.push(stringNumber);
      return;
    }
    if (fret === 0) {
      open.push(stringNumber);
      return;
    }
    const finger = entry.fingers[index];
    if (finger === null) return;

    const barre = entry.barre;
    const underBarre =
      barre !== undefined &&
      finger === barre.finger &&
      fret === barre.fret &&
      stringNumber >= barre.fromString &&
      stringNumber <= barre.toString;

    if (underBarre) {
      // One entry for the whole barre, placed where the finger's weight goes:
      // the thick end, which is the part beginners let slip.
      if (seenBarre.has(finger)) return;
      seenBarre.add(finger);
      placements.push({ finger, string: barre.toString, fret, underBarre: true });
      return;
    }
    placements.push({ finger, string: stringNumber, fret });
  });

  return { shape: entry, placements, open, muted, barre: entry.barre };
}
