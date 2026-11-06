/**
 * What each string and fret is called.
 *
 * Standard tuning only, and deliberately so: a class for someone who does not
 * yet know where their fingers go should not also be asking them what tuning
 * they are in. The numbers are MIDI note numbers, which makes "what note is
 * this" one addition instead of a table per string.
 */

/** The twelve pitch classes, written the way English-speaking musicians write them. */
export const LETTER_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** The same twelve in do-re-mi, used across most of Europe and Latin America. */
export const SOLFEGE_NAMES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"] as const;

/**
 * Open strings in standard tuning, as MIDI numbers, indexed by string number.
 * Index 0 is unused so that `OPEN[1]` is the thin E — the same numbering
 * guitarists, tabs and this whole code base use.
 */
export const OPEN_STRINGS = [0, 64, 59, 55, 50, 45, 40] as const;

/** The MIDI note a string gives at a fret. Fret 0 is the open string. */
export function noteAt(stringNumber: number, fret: number): number {
  const open = OPEN_STRINGS[stringNumber] ?? OPEN_STRINGS[1];
  return open + Math.max(0, Math.round(fret));
}

/**
 * The frequency of a MIDI note. Equal temperament, A above middle C as the
 * anchor — the same arithmetic every tuner on earth uses.
 */
export function frequencyOf(midi: number, referenceA = 440): number {
  return referenceA * Math.pow(2, (midi - 69) / 12);
}

/**
 * How far one frequency is from another, in cents — hundredths of a semitone.
 *
 * Cents rather than hertz because the ear works in ratios: six hertz flat is
 * inaudible on the thin E and a quarter-tone on the thick one, and a tuner
 * that reported hertz would be lying about how wrong the string is.
 */
export function centsBetween(frequency: number, target: number): number {
  if (frequency <= 0 || target <= 0) return 0;
  return 1200 * Math.log2(frequency / target);
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function letterName(midi: number): string {
  return LETTER_NAMES[pitchClass(midi)];
}

export function solfegeName(midi: number): string {
  return SOLFEGE_NAMES[pitchClass(midi)];
}

/** Scientific pitch notation's octave: middle C (MIDI 60) is C4, the thick E is E2. */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** The name a student reads fastest, given the language they chose. */
export function noteName(midi: number, notation: "letter" | "solfege"): string {
  return notation === "letter" ? letterName(midi) : solfegeName(midi);
}

