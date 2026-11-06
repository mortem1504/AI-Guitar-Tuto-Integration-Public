/**
 * Reading a pasted chord chart.
 *
 * The input is whatever the player copied: chords alone, chords over lyrics,
 * section headers, and whatever junk the website wrapped around them. Real
 * charts taught this parser three things the hard way:
 *
 *   - Lyrics can look like chords. "Do you?" contains a perfectly plausible
 *     chord token, and Leonard Cohen is not going to stop asking. So a line
 *     only counts as a chord line when it contains at least one real chord
 *     and NO ordinary words — genuine chord lines never have any.
 *   - Sites wrap chords in punctuation ("&gt;C rendered as ">C). Tokens are
 *     stripped of wrapping junk before parsing, so those chords survive.
 *   - Chord lines carry annotations — x2, (bis), N.C., bar lines — that must
 *     not disqualify them.
 */

/**
 * The chord qualities a chart can name, reduced to the ones a guitar class can
 * actually teach. Kept local on purpose: the parser has to stay independent of
 * the chord library, so a chart can be read before anything decides whether a
 * shape for it exists.
 */
export type ChordQuality =
  | "maj"
  | "min"
  | "dom7"
  | "maj7"
  | "min7"
  | "dom9"
  | "min9"
  | "maj6"
  | "min6"
  | "sus2"
  | "sus4"
  | "dim";

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface QualityRule {
  shape: ChordQuality;
  /** Set when the written chord is not exactly playable and this is the nearest. */
  approximated?: boolean;
}

/**
 * Every suffix the parser understands, mapped to the closest playable shape.
 * Exact matches first; below them, the chords that get simplified — a 13th
 * played as a plain dominant still functions as one.
 *
 * Deliberately absent: "o" as diminished ("Co"). It is real but rare notation,
 * and it makes the English word "Do" parse as D diminished — a lyric, not a
 * chord. "dim", "°" and "º" all still work.
 */
const QUALITIES: Record<string, QualityRule> = {
  "": { shape: "maj" },
  maj: { shape: "maj" },
  M: { shape: "maj" },
  m: { shape: "min" },
  min: { shape: "min" },
  "-": { shape: "min" },
  "7": { shape: "dom7" },
  "9": { shape: "dom9" },
  maj7: { shape: "maj7" },
  M7: { shape: "maj7" },
  "Δ": { shape: "maj7" },
  "Δ7": { shape: "maj7" },
  m7: { shape: "min7" },
  min7: { shape: "min7" },
  m9: { shape: "min9" },
  "6": { shape: "maj6" },
  m6: { shape: "min6" },
  sus2: { shape: "sus2" },
  sus4: { shape: "sus4" },
  sus: { shape: "sus4" },
  dim: { shape: "dim" },
  "°": { shape: "dim" },
  "º": { shape: "dim" },

  maj9: { shape: "maj7", approximated: true },
  add9: { shape: "maj", approximated: true },
  madd9: { shape: "min", approximated: true },
  "69": { shape: "maj6", approximated: true },
  "6/9": { shape: "maj6", approximated: true },
  m7b5: { shape: "min7", approximated: true },
  "ø": { shape: "min7", approximated: true },
  "ø7": { shape: "min7", approximated: true },
  dim7: { shape: "dim", approximated: true },
  "°7": { shape: "dim", approximated: true },
  aug: { shape: "maj", approximated: true },
  "+": { shape: "maj", approximated: true },
  "7sus4": { shape: "sus4", approximated: true },
  "11": { shape: "dom7", approximated: true },
  "13": { shape: "dom7", approximated: true },
  "7b9": { shape: "dom7", approximated: true },
  "7#9": { shape: "dom7", approximated: true },
  "5": { shape: "maj", approximated: true },
};

export interface SongChord {
  /** As the player wrote it, junk stripped: "Bbmaj7", "E7/G#". */
  token: string;
  /** Pitch class of the root, 0 to 11. */
  pc: number;
  /** The quality it will be taught as. */
  shape: ChordQuality;
  /** The written quality, when the played one is only an approximation. */
  approximatedFrom?: string;
  /** A slash bass that will not sound — inversions are not playable yet. */
  bass?: string;
}

export interface ParsedSong {
  /** Every chord, in playing order, repeats included. */
  sequence: SongChord[];
  /** Tokens that looked like chords but could not be read. */
  skipped: string[];
}

const CHORD_PATTERN = /^([A-G])([#♯b♭]?)([^/]*)(?:\/([A-G][#♯b♭]?))?$/;

/** Wrapping junk that websites and typists put around chords. */
const JUNK = /["'“”‘’<>«»¿?¡!;:.,()[\]]/g;

/** Things that legitimately sit on a chord line without being chords.
 *  Standalone slashes are beat and walk marks — "G / / /" holds the chord,
 *  "D \ C" separates two — and must not read as words, or the whole line
 *  gets mistaken for lyrics and a verse disappears. */
const ANNOTATION = /^(x\d+|\d+x|bis|n\.?c\.?|%|\|+|[-–—=_~]+|[\\/]+|\d+)$/i;

export function parseChordToken(token: string): SongChord | null {
  const cleaned = token.replace(JUNK, "").trim();
  const match = CHORD_PATTERN.exec(cleaned);
  if (!match) return null;

  const [, letter, accidental, suffix, bass] = match;
  const rule = QUALITIES[suffix as keyof typeof QUALITIES] ?? QUALITIES[suffix.toLowerCase()];
  if (!rule) return null;

  let pc = NOTE_PC[letter];
  if (accidental === "#" || accidental === "♯") pc += 1;
  if (accidental === "b" || accidental === "♭") pc -= 1;

  return {
    token: cleaned,
    pc: ((pc % 12) + 12) % 12,
    shape: rule.shape,
    approximatedFrom: rule.approximated ? letter + accidental + suffix : undefined,
    bass: bass || undefined,
  };
}

type TokenKind = "chord" | "annotation" | "chordish" | "word";

function classify(raw: string): { kind: TokenKind; chord?: SongChord; cleaned: string } {
  const cleaned = raw.replace(JUNK, "").trim();
  if (!cleaned) return { kind: "annotation", cleaned };

  const chord = parseChordToken(cleaned);
  if (chord) return { kind: "chord", chord, cleaned };

  // A parenthesised aside on a chord line — "(bis)", "(or", "softly)".
  if (raw.startsWith("(") || raw.endsWith(")")) return { kind: "annotation", cleaned };
  if (ANNOTATION.test(cleaned)) return { kind: "annotation", cleaned };

  // Starts like a chord but does not parse: probably an exotic chord worth
  // reporting — as long as the rest of the line says this is a chord line.
  if (/^[A-G][#♯b♭]?/.test(cleaned)) return { kind: "chordish", cleaned };

  return { kind: "word", cleaned };
}

export function parseSong(text: string): ParsedSong {
  const sequence: SongChord[] = [];
  const skipped: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    // Section headers like [Chorus] or (Intro) are structure, not chords.
    const stripped = line.replace(/\[[^\]]*\]/g, " ").trim();
    if (!stripped) continue;

    const tokens = stripped.split(/[\s|]+/).filter(Boolean).map(classify);

    // A chord line has at least one real chord and no ordinary words. One
    // word is enough to make it lyrics: real chord lines never contain any.
    const chords = tokens.filter((token) => token.kind === "chord");
    const hasWords = tokens.some((token) => token.kind === "word");
    if (chords.length === 0 || hasWords) continue;

    for (const token of tokens) {
      if (token.kind === "chord" && token.chord) sequence.push(token.chord);
      else if (token.kind === "chordish") skipped.push(token.cleaned);
    }
  }

  return { sequence, skipped };
}
