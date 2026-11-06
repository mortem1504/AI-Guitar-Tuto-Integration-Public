/**
 * Where the fingers go: for the note being asked for in a song lesson, which
 * finger presses which string and fret, the next one or two, where the hand
 * sits, whether it has to move first, and the technique that joins them.
 *
 * One answer, two views: the fretboard diagram under "Play this"
 * (`ui/FretDiagram.ts`) and the dots on the camera picture
 * (`render/guidanceLayer.ts`). Fingers are `fingering.ts`'s, and always a
 * suggestion. Pure apart from the translation it is handed; `npm run
 * guidance-check` exercises it.
 */

import type { Translate, TranslationKey } from "../i18n";
import type { Breakdown } from "./breakdown";
import { pressed, SPAN } from "./fingering";
import type { TabNote, Technique } from "./model";

export type Finger = 0 | 1 | 2 | 3 | 4;

export interface FingerTarget {
  string: number;
  fret: number;
  /** 0: an open string, or a note no finger presses (harmonic, tap, dead). */
  finger: Finger;
  role: "now" | "next" | "later";
  /** Drawn as an arrow: a hammer-on, pull-off or slide to `techniqueTarget`; a bend, release or vibrato on the note itself. */
  technique?: Technique;
  techniqueTarget?: { string: number; fret: number };
  /** For a bend: how far, in semitones. */
  bendSemitones?: number;
}

export interface Guidance {
  targets: FingerTarget[];
  /** The four frets the hand covers for the note being asked for. */
  handWindow: { fromFret: number; toFret: number };
  /** The hand moves to another position before the next note. */
  shift?: { from: number; to: number };
  /** The same, said in words, for the line under the diagram. */
  text: string;
}

/** The techniques that join a note to the one after it on the same string. */
const JOINS: readonly Technique[] = ["hammer", "pull", "slideUp", "slideDown"];
/** Those drawn on the note itself. */
const ON_NOTE: readonly Technique[] = ["bend", "release", "vibrato"];

/** At most this many notes ahead: the brief's "now, next, later", three dots at most. */
export const MAX_AHEAD = 2;

/**
 * The guidance at column `column` of a step's `order` (event indices, as
 * `stepEvents` gives them). `ahead` is how many following notes to show (0-2).
 * A chord shows all its fingers as "now", and nothing after it: a chord is
 * already a handful.
 */
export function guidanceAt(breakdown: Breakdown, order: readonly number[], column: number, ahead: number, t: Translate): Guidance | null {
  const { song, fingering } = breakdown;
  const index = order[column];
  if (index === undefined) return null;
  const event = song.events[index];
  const placed = fingering.events[index];
  const position = placed?.position ?? 1;
  const targets: FingerTarget[] = event.notes.map((note, k) => ({ string: note.string, fret: note.fret, finger: (placed?.fingers[k] ?? 0) as Finger, role: "now" }));

  const chord = event.notes.length > 1;
  const following = chord ? [] : order.slice(column + 1, column + 1 + Math.max(0, Math.min(MAX_AHEAD, ahead)));
  following.forEach((next, j) => {
    const note = lead(song.events[next].notes);
    const k = song.events[next].notes.indexOf(note);
    targets.push({ string: note.string, fret: note.fret, finger: (fingering.events[next]?.fingers[k] ?? 0) as Finger, role: j === 0 ? "next" : "later" });
  });

  // The technique, on the note being asked for: one that joins it to the next note on the same string, or its own.
  if (!chord) {
    const now = targets[0];
    const own = event.notes[0];
    const nextIndex = order[column + 1];
    const after = nextIndex !== undefined && nextIndex === index + 1 ? song.events[nextIndex].notes : [];
    const joined = after.length === 1 && after[0].string === own.string ? JOINS.find((x) => after[0].techniques.includes(x)) : undefined;
    if (joined) {
      now.technique = joined;
      now.techniqueTarget = { string: after[0].string, fret: after[0].fret };
    } else {
      const technique = ON_NOTE.find((x) => own.techniques.includes(x));
      if (technique) now.technique = technique;
      if (technique === "bend") now.bendSemitones = own.bendSemitones ?? 2;
    }
  }

  const nextIndex = order[column + 1];
  const nextPosition = nextIndex !== undefined ? fingering.events[nextIndex] : undefined;
  const shift = nextPosition && nextPosition.position !== position && song.events[nextIndex!].notes.some(pressed) ? { from: position, to: nextPosition.position } : undefined;

  return { targets, handWindow: { fromFret: position, toFret: position + SPAN - 1 }, ...(shift ? { shift } : {}), text: sayIt(t, targets, chord, shift) };
}

/** The note of a chord the hand leads with when it is shown as "next": the one on the thickest string. */
function lead(notes: readonly TabNote[]): TabNote {
  return notes.reduce((a, b) => (b.string > a.string ? b : a));
}

function sayIt(t: Translate, targets: readonly FingerTarget[], chord: boolean, shift: Guidance["shift"]): string {
  const now = targets.filter((x) => x.role === "now");
  const where = (x: FingerTarget) => t("guide.where", { string: x.string, name: t(`string.${x.string}` as TranslationKey), fret: x.fret });
  let text: string;
  if (chord) text = t("guide.chord", { fingers: now.map((x) => (x.finger ? `${x.finger}→${where(x)}` : `0→${where(x)}`)).join(", ") });
  else if (now[0].finger === 0) text = now[0].fret === 0 ? t("guide.open", { string: now[0].string, name: t(`string.${now[0].string}` as TranslationKey) }) : t("guide.noFinger", { where: where(now[0]) });
  else text = t("guide.finger", { finger: t(`finger.${now[0].finger}` as TranslationKey), where: where(now[0]) });
  if (shift) text += ` ${t("guide.shift", { fret: shift.to })}`;
  return `${text} ${t("guide.suggested")}`;
}

// --- Where a fingertip is, against where it should be ----------------------------------

/** "One string too low", "two frets too far": the single correction for a finger that the camera sees off target. */
export type Miss = { kind: "string"; by: number; thicker: boolean } | { kind: "fret"; by: number; far: boolean };

/**
 * How a fingertip at a fractional `string` and continuous `wire` (as
 * `positionOf` gives them) misses a target, beyond the judge's slack; null
 * when it is close enough. The fret is said first, as the judge does: a
 * wrong fret is a wrong note.
 */
export function missOf(target: { string: number; fret: number }, seen: { string: number; wire: number }, slack: { string: number; fret: number }): Miss | null {
  const low = target.fret - 1;
  const fretOut = seen.wire < low ? low - seen.wire : seen.wire > target.fret ? seen.wire - target.fret : 0;
  if (fretOut > slack.fret) return { kind: "fret", by: Math.max(1, Math.round(fretOut)), far: seen.wire > target.fret };
  const stringOut = Math.abs(seen.string - target.string);
  if (stringOut > slack.string) return { kind: "string", by: Math.max(1, Math.round(stringOut)), thicker: seen.string > target.string };
  return null;
}

export function missText(t: Translate, miss: Miss): string {
  const key = miss.kind === "fret" ? (miss.far ? "guide.miss.far" : "guide.miss.short") : miss.thicker ? "guide.miss.low" : "guide.miss.high";
  return t(miss.by > 1 ? (`${key}Many` as TranslationKey) : key, { count: miss.by });
}
