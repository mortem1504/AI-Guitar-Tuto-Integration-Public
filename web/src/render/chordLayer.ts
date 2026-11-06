/**
 * Turning a judged chord into things to draw on the neck.
 *
 * Kept apart from both the judge and the canvas: the judge decides what is
 * true, this decides what is worth showing, and the Overlay only knows how to
 * put a circle somewhere. The middle step is where the teaching happens — most
 * of what is *true* about a wrong chord is noise a student cannot act on.
 *
 * What earns a place on screen:
 *
 *   - Every finger the chord wants, coloured by whether it is there yet.
 *   - An arrow from a wrong finger to where it belongs. One correction, drawn,
 *     beats four sentences.
 *   - The open and muted strings at the nut, because "don't play the thick E"
 *     is half of what makes a beginner's chord sound bad and is invisible in
 *     any finger-only display.
 */

import type { Fretboard } from "../guitar/Fretboard";
import type { ChordTarget } from "../guitar/chords";
import type { ChordJudgement } from "../guitar/judge";
import { noteAt, noteName } from "../guitar/tuning";
import type { Marker } from "./Overlay";
import { DIM, RIGHT, TARGET, WRONG } from "./palette";
import type { Point } from "../vision/landmarks";

export interface ChordLayer {
  markers: Marker[];
  /** Arrows: a finger that is somewhere, and where it should be instead. */
  nudges: { from: Point; to: Point; colour: string }[];
}

export interface LayerOptions {
  showNoteNames: boolean;
  notation: "letter" | "solfege";
}

export function chordLayer(
  board: Fretboard,
  target: ChordTarget,
  judgement: ChordJudgement,
  options: LayerOptions,
): ChordLayer {
  const markers: Marker[] = [];
  const nudges: ChordLayer["nudges"] = [];

  for (const entry of judgement.perFinger) {
    const { placement, verdict, seen } = entry;
    const at = board.pointFor(placement.string, placement.fret);
    const colour = verdict === "correct" ? RIGHT : verdict === "missing" ? TARGET : WRONG;

    markers.push({
      at,
      colour,
      // Filled once it is right: the target stops being a target and becomes
      // a fact, which is the whole reward for getting there.
      filled: verdict === "correct",
      label: labelFor(placement.finger, placement.string, placement.fret, options),
      radius: placement.underBarre ? 13 : 16,
      along: board.pointFor(placement.string, 12),
    });

    if (seen && verdict !== "correct" && verdict !== "missing") {
      nudges.push({ from: seen.camera, to: at, colour: WRONG });
    }
  }

  // Open and muted strings, drawn small at the nut so they never compete with
  // the fingers but are impossible to miss once you look.
  for (const stringNumber of target.open) {
    markers.push({ at: board.pointFor(stringNumber, 0), colour: DIM, filled: false, radius: 8 });
  }
  for (const stringNumber of target.muted) {
    markers.push({ at: board.pointFor(stringNumber, 0), colour: DIM, filled: false, radius: 8, label: "×" });
  }

  return { markers, nudges };
}

/**
 * What goes inside the circle: the finger number, or the note that finger
 * makes when the student has asked to be told.
 *
 * The finger number is the more useful of the two while learning a shape, so
 * naming the notes is a setting and not the default — it is for the student who
 * has started wondering *why* the shape is that shape.
 */
function labelFor(finger: number, stringNumber: number, fret: number, options: LayerOptions): string {
  if (!options.showNoteNames) return String(finger);
  return noteName(noteAt(stringNumber, fret), options.notation);
}
