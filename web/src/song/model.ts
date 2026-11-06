/**
 * A song read from a tab: what the "bring your own tab" teacher works on.
 *
 * Every importer (plain-text tabs, later Guitar Pro and MusicXML) produces a
 * `Song`; the breakdown, the fingering and the lessons only ever read this.
 * Pure data and pure functions: no DOM, no audio, so the whole chain runs in
 * Node (`npm run tab-check`).
 *
 * Strings are numbered the way tabs and the rest of this code base number
 * them: 1 is the thin (high) E, 6 the thick (low) E. `tuning` is written the
 * way tunings are usually written, low string first.
 */

export type Technique =
  | "hammer"
  | "pull"
  | "slideUp"
  | "slideDown"
  | "bend"
  | "release"
  | "vibrato"
  | "harmonic"
  | "palmMute"
  | "dead"
  | "tap";

/** Every technique, for checking stored songs against. */
export const TECHNIQUES: readonly Technique[] = ["hammer", "pull", "slideUp", "slideDown", "bend", "release", "vibrato", "harmonic", "palmMute", "dead", "tap"];

export interface TabNote {
  /** 1 = high e … 6 = low E. */
  string: number;
  /** 0-24, counted from the capo when there is one. 0 for a dead note, which has no fret. */
  fret: number;
  /** What sounds, from the tuning and the capo. Meaningless for a dead note. */
  midi: number;
  techniques: Technique[];
  /** For a bend: how far it is bent, in semitones (2 = a whole tone, "full"). */
  bendSemitones?: number;
}

/** One moment in time: usually one note, sometimes a chord. */
export interface TabEvent {
  index: number;
  notes: TabNote[];
  /** Position in quarter notes from the start, when the source has rhythm. Null for text tabs. */
  beat: number | null;
  /** Length in quarter notes, ties included. Null for text tabs. */
  durationBeats: number | null;
  /**
   * Text tabs only: columns since the previous event in the same staff. A
   * rough hint that wider gaps are longer notes, never a rhythm. Null for the
   * first event of a staff, and for sources with real rhythm.
   */
  spacing: number | null;
  /**
   * Where it came from, for "show me in the original": in a text tab the
   * 1-based line and 0-based column, in a score the bar number and the beat
   * within the bar.
   */
  sourceLine: number;
  sourceColumn: number;
}

/** A label written in the tab ("[Intro]", "Chorus", "Riff 1"), before the event it names. */
export interface SectionLabel {
  name: string;
  /** Index of the first event after the label. */
  beforeEvent: number;
  sourceLine: number;
}

/** "x2", "repeat 4 times", "|: … :|": recorded, not expanded; the breakdown decides. */
export interface RepeatHint {
  fromEvent: number;
  toEvent: number;
  times: number;
  sourceLine: number;
}

/** Filled by the breakdown step (Phase 4); empty when a song has just been read. */
export interface Section {
  name: string;
  firstEvent: number;
  lastEvent: number;
}

export interface Song {
  title: string;
  artist?: string;
  /** Low string first, e.g. ["E2", "A2", "D3", "G3", "B3", "E4"]. */
  tuning: string[];
  capo: number;
  tempo: number | null;
  timeSignature: [number, number] | null;
  events: TabEvent[];
  sections: Section[];
  labels: SectionLabel[];
  repeats: RepeatHint[];
  /** Everything the reader was unsure about, in plain language. */
  warnings: string[];
  source: "text" | "guitarpro" | "musicxml";
}

// --- Tunings -----------------------------------------------------------------

export const STANDARD: readonly string[] = ["E2", "A2", "D3", "G3", "B3", "E4"];

/** The alternates a tab names most often, by the names people write them under. */
export const NAMED_TUNINGS: Readonly<Record<string, readonly string[]>> = {
  standard: STANDARD,
  "e standard": STANDARD,
  "drop d": ["D2", "A2", "D3", "G3", "B3", "E4"],
  "eb standard": ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"],
  "d# standard": ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"],
  "half step down": ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"],
  "half-step down": ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"],
  "1/2 step down": ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"],
  dadgad: ["D2", "A2", "D3", "G3", "A3", "D4"],
};

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The pitch class of "E", "eb", "F#", "Bb"; null for anything else. */
export function pitchClassOf(name: string): number | null {
  const match = /^([A-Ga-g])([#b]?)$/.exec(name.trim());
  if (!match) return null;
  const base = PITCH_CLASS[match[1].toUpperCase()];
  const shift = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (base + shift + 12) % 12;
}

/** "E2" -> 40, "D#4" -> 63, "Bb3" -> 58; null when it is not a note with an octave. */
export function midiOfName(name: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!match) return null;
  // The octave belongs to the letter: B#3 is C4, Cb4 is B3.
  const shift = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + PITCH_CLASS[match[1].toUpperCase()] + shift;
}

/** 40 -> "E2". Sharps, as `tuning.ts` writes them. */
export function nameOfMidi(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Pitch classes for the six strings (low first) -> a tuning with octaves, each
 * string put in the octave nearest its standard pitch. That reads D on the
 * low string as D2 (Drop D, two semitones down) and A on the B string as A3
 * (DADGAD), which is how every alternate tuning in common use works.
 */
export function tuningFromPitchClasses(classes: readonly number[]): string[] {
  return classes.map((pc, i) => {
    const standard = midiOfName(STANDARD[i])!;
    let best = standard;
    for (let midi = standard - 6; midi <= standard + 5; midi++) {
      if (((midi % 12) + 12) % 12 === pc) best = midi;
    }
    return nameOfMidi(best);
  });
}

/** The open string's MIDI note for string 1 (high e) … 6 (low E). */
export function openMidi(tuning: readonly string[], stringNumber: number): number {
  return midiOfName(tuning[6 - stringNumber] ?? "") ?? midiOfName(STANDARD[6 - stringNumber])!;
}

/** What a fret sounds like: open string, plus the capo, plus the fret. */
export function midiAt(tuning: readonly string[], capo: number, stringNumber: number, fret: number): number {
  return openMidi(tuning, stringNumber) + capo + fret;
}

/**
 * Natural harmonics sound above the open string by the interval of the node,
 * not the fret: 12th = an octave, 7th = an octave and a fifth, 5th = two
 * octaves. The 4th/9th/16th node is a major third over two octaves (28
 * semitones, 14 cents flat of equal temperament, inside the judge's window).
 */
const HARMONIC_SEMITONES: Readonly<Record<number, number>> = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28 };

/** The note a tab note makes: the fret, or the harmonic's node, from the tuning and capo. */
export function soundingMidi(note: Pick<TabNote, "string" | "fret" | "techniques">, tuning: readonly string[], capo: number): number {
  const open = openMidi(tuning, note.string) + capo;
  if (note.techniques.includes("harmonic") && HARMONIC_SEMITONES[note.fret] !== undefined) return open + HARMONIC_SEMITONES[note.fret];
  return open + note.fret;
}

/** The same song in another tuning or with another capo: every note's MIDI recomputed. */
export function retune(song: Song, tuning: readonly string[], capo: number): Song {
  return {
    ...song,
    tuning: [...tuning],
    capo,
    events: song.events.map((event) => ({
      ...event,
      notes: event.notes.map((note) => ({ ...note, midi: soundingMidi(note, tuning, capo) })),
    })),
  };
}
