/**
 * Every place on the neck a pitch can be played.
 *
 * The heart of why audio and vision need each other: E4 is the open thin E,
 * the B string's 5th fret, the G string's 9th, the D string's 14th, the A
 * string's 19th and the thick E's 24th. The microphone hears one note; only
 * the hand can say which of those six it came from.
 *
 * Standard tuning, from `guitar/tuning.ts`. Pure.
 */

import { OPEN_STRINGS } from "../guitar/tuning";

export interface Candidate {
  /** 1 is the thin E. */
  string: number;
  /** 0 is the open string. */
  fret: number;
}

/** The (string, fret) pairs that give `midi`, thin string first, frets 0 to `maxFret`. */
export function candidatesFor(midi: number, maxFret = 24): Candidate[] {
  const candidates: Candidate[] = [];
  for (let string = 1; string <= 6; string++) {
    const fret = midi - OPEN_STRINGS[string];
    if (fret >= 0 && fret <= maxFret) candidates.push({ string, fret });
  }
  return candidates;
}
