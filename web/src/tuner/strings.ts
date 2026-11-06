/**
 * Which string is that, and how far out is it.
 *
 * A tuner that reports "F#, 40 cents flat" is a tuner for someone who already
 * knows what they are doing. A beginner needs "that is your D string, tighten
 * it" — so this maps whatever was heard onto the six open strings rather than
 * onto the chromatic scale, and says plainly when what it heard is not near any
 * of them.
 */

import { centsBetween, frequencyOf, noteAt } from "../guitar/tuning";
import { STRING_COUNT } from "../guitar/geometry";

/** 1 to 6, thin E first, the order the tuner walks them in. */
export const STRING_NUMBERS = Array.from({ length: STRING_COUNT }, (_, i) => i + 1);

/**
 * Anything further from an open string than this is not that string.
 *
 * The widest gap between neighbouring open strings is five semitones, so a
 * limit of 250 cents would claim *every* pitch as some string — including a
 * fretted note, which then reads as a horribly out-of-tune open one and sends
 * the student to a peg that was fine. A semitone and a half is the compromise:
 * loose enough for a genuinely slack string, tight enough that most of what is
 * not an open string is reported as nothing at all.
 *
 * Some ambiguity is not removable. A pitch exactly between two strings has no
 * right answer without knowing what the student meant to play.
 */
const CLAIM_LIMIT_CENTS = 150;

/** Inside this, a string is in tune. Well below what an ear can hear. */
export const IN_TUNE_CENTS = 5;

export interface StringMatch {
  /** 1 (thin E) to 6 (thick E). */
  string: number;
  /** The MIDI note that string should give open. */
  midi: number;
  /** Its target frequency. */
  target: number;
  /** How far the heard pitch is from it. Negative is flat. */
  cents: number;
  inTune: boolean;
}

/**
 * The open string a heard frequency belongs to, or null when it belongs to
 * none — a fretted note, a cough, someone talking.
 *
 * Nearest in cents, not in hertz: the strings are not evenly spaced in hertz,
 * and a hertz comparison would drag every ambiguous reading towards the thin E.
 */
export function matchString(frequency: number, referenceA = 440): StringMatch | null {
  let best: StringMatch | null = null;

  for (const string of STRING_NUMBERS) {
    const midi = noteAt(string, 0);
    const target = frequencyOf(midi, referenceA);
    const cents = centsBetween(frequency, target);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) {
      best = { string, midi, target, cents, inTune: Math.abs(cents) <= IN_TUNE_CENTS };
    }
  }

  if (!best || Math.abs(best.cents) > CLAIM_LIMIT_CENTS) return null;
  return best;
}
