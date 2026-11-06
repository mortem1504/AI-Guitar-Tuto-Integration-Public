/**
 * A song lesson's finger guidance on the camera picture: the same dots as the
 * fretboard diagram, projected through the calibrated neck onto the real
 * guitar, in the middle of each fret box (`Fretboard.pointFor`, behind the
 * wire, never on it).
 *
 * Like `chordLayer`, it decides what is worth drawing and leaves the drawing
 * to the Overlay. Two rules from the brief:
 *
 *   - **One problem at a time.** If the suggested finger's tip is off its
 *     target by more than the judge's slack, one arrow from the tip to the
 *     target, and one short sentence. Never more than one.
 *   - **The camera never says "right".** The dot turns green only when the
 *     microphone has heard the right note (`confirmed`); a finger hovering
 *     over the right box is not a note played.
 */

import type { Fretboard } from "../guitar/Fretboard";
import type { NeckReading } from "../guitar/FretReader";
import type { Translate } from "../i18n";
import { missOf, missText, type FingerTarget } from "../song/guidance";
import type { Point } from "../vision/landmarks";
import type { Marker } from "./Overlay";
import { DIM, RIGHT, TARGET, WRONG } from "./palette";

export interface GuideLayer {
  markers: Marker[];
  nudge: { from: Point; to: Point; colour: string } | null;
  message: string;
}

export interface GuideInput {
  targets: readonly FingerTarget[];
  /** A note the microphone just confirmed, tab-numbered (from the capo). */
  confirmed: { string: number; fret: number } | null;
  /** Tab frets count from the capo; the neck's frets count from the nut. */
  capo: number;
  numbers: boolean;
}

export function guidanceLayer(board: Fretboard, guide: GuideInput, reading: NeckReading | null, slack: { string: number; fret: number }, t: Translate): GuideLayer {
  const markers: Marker[] = [];
  const at = (string: number, fret: number) => board.pointFor(string, fret + guide.capo);
  // Later first, now last, so the dot that matters is drawn on top.
  const rank = { later: 0, next: 1, now: 2 } as const;
  for (const target of [...guide.targets].sort((a, b) => rank[a.role] - rank[b.role])) {
    const open = target.fret === 0 && guide.capo === 0;
    const label = open ? "0" : guide.numbers && target.finger > 0 ? String(target.finger) : undefined;
    // Now and next may be off the picture with the nut; they are pinned to the edge on their string.
    const along = open || target.role === "later" ? undefined : board.pointFor(target.string, 12);
    if (target.role === "now") markers.push({ at: at(target.string, target.fret), colour: TARGET, filled: !open, label, radius: open ? 10 : 16, along });
    else markers.push({ at: at(target.string, target.fret), colour: target.role === "next" ? TARGET : DIM, filled: false, label, radius: target.role === "next" ? 11 : 9, along });
  }
  if (guide.confirmed) markers.push({ at: at(guide.confirmed.string, guide.confirmed.fret), colour: RIGHT, filled: true, label: "✓", radius: 16 });

  // The first "now" finger the camera sees off its box: the one problem worth saying.
  for (const target of guide.targets) {
    if (target.role !== "now" || target.finger === 0) continue;
    const seen = reading?.fingers.find((finger) => finger.finger === target.finger && finger.onBoard);
    if (!seen) continue;
    const miss = missOf({ string: target.string, fret: target.fret + guide.capo }, seen.position, slack);
    if (!miss) continue;
    return { markers, nudge: { from: seen.camera, to: at(target.string, target.fret), colour: WRONG }, message: missText(t, miss) };
  }
  return { markers, nudge: null, message: "" };
}
