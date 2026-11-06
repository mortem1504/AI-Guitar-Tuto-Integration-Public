/**
 * The shape of a fretboard, in the fretboard's own units.
 *
 * Everything here lives in a flat plane measured in *scale lengths*: x runs
 * from 0 at the nut to 1 at the bridge, y runs across the neck with 0 down the
 * middle. Nothing here knows about cameras, pixels or perspective — that is
 * the homography's job (see `Fretboard`). Keeping the two apart is what lets
 * the fret maths be checked on paper.
 *
 * Two facts do all the work:
 *
 *   - **Frets are logarithmic.** Fret n sits at `1 - 2^(-n/12)` of the scale,
 *     because twelve of them have to halve the string. The 12th fret is
 *     therefore at exactly 0.5 — which is why it is the landmark the student
 *     is asked to click.
 *   - **The neck is a trapezoid.** It is narrow at the nut and wider up the
 *     neck, and that taper is linear. Ignoring it puts the thin-E string a
 *     couple of millimetres off by the 12th fret, which is a whole string's
 *     width of error.
 */

import type { GuitarKind } from "../app/settings";

/** Strings are numbered the way guitarists number them: 1 is the thin E. */
export const STRING_COUNT = 6;

export interface GuitarSpec {
  kind: GuitarKind;
  /** Scale length in millimetres, for turning the model into real distances. */
  scaleLengthMm: number;
  /** Fretboard width at the nut, as a fraction of the scale length. */
  nutWidth: number;
  /** Fretboard width at the 12th fret, same units. */
  twelfthWidth: number;
  /**
   * The highest fret a lesson should send anyone to. On an acoustic the body
   * meets the neck around the 14th and the hand runs out of room; an electric
   * has a cutaway and stays playable much further up.
   */
  maxTeachableFret: number;
}

export const GUITARS: Record<GuitarKind, GuitarSpec> = {
  // 25.4" scale, 43 mm nut, ~54 mm at the 12th.
  acoustic: { kind: "acoustic", scaleLengthMm: 645, nutWidth: 0.0667, twelfthWidth: 0.0837, maxTeachableFret: 12 },
  // 25.5" scale, 42 mm nut, ~52 mm at the 12th.
  electric: { kind: "electric", scaleLengthMm: 648, nutWidth: 0.0648, twelfthWidth: 0.0802, maxTeachableFret: 15 },
};

/** A point on the fretboard plane, in scale lengths. */
export interface BoardPoint {
  x: number;
  y: number;
}

/** Where the wire of fret `n` sits. Fret 0 is the nut itself. */
export function fretLine(fret: number): number {
  return 1 - Math.pow(2, -fret / 12);
}

/**
 * Where a finger should actually sit for fret `n`: in the box behind the wire,
 * a little closer to it than to the previous one, which is what a teacher
 * means by "right behind the fret".
 */
export function fretCentre(fret: number): number {
  if (fret <= 0) return 0;
  const behind = fretLine(fret - 1);
  const wire = fretLine(fret);
  return behind + (wire - behind) * 0.62;
}

/** Half the width of the fretboard at a given distance from the nut. */
export function halfWidthAt(spec: GuitarSpec, x: number): number {
  // Linear taper, anchored on the two widths we know. Extrapolates sensibly
  // past the 12th fret, which is where an electric lesson can reach.
  const t = x / 0.5;
  return (spec.nutWidth + (spec.twelfthWidth - spec.nutWidth) * t) / 2;
}

/**
 * How much of the board's half-width is empty margin outside the two E
 * strings. The outer strings do not sit on the very edge of the wood — about
 * 3 mm of it is bare on each side, and a finger judged against the edge instead
 * of the string is judged a whole string out.
 */
const EDGE_MARGIN = 0.11;

/**
 * Where string `s` crosses the board at distance `x` from the nut.
 * Positive y is the thick-E side, matching the order the corners are marked in.
 */
export function stringOffset(spec: GuitarSpec, stringNumber: number, x: number): number {
  const usable = halfWidthAt(spec, x) * (1 - EDGE_MARGIN);
  // string 6 -> +1, string 1 -> -1
  const across = (stringNumber - (STRING_COUNT + 1) / 2) / ((STRING_COUNT - 1) / 2);
  return usable * across;
}

/** The point a fingertip should land on for a given string and fret. */
export function boardPoint(spec: GuitarSpec, stringNumber: number, fret: number): BoardPoint {
  const x = fretCentre(fret);
  return { x, y: stringOffset(spec, stringNumber, x) };
}

/** The two ends of a fret wire, for drawing the grid. */
export function fretWire(spec: GuitarSpec, fret: number): [BoardPoint, BoardPoint] {
  const x = fretLine(fret);
  const half = halfWidthAt(spec, x);
  return [
    { x, y: -half },
    { x, y: half },
  ];
}

/** A string, drawn from the nut to the last fret shown. */
export function stringLine(spec: GuitarSpec, stringNumber: number, lastFret: number): [BoardPoint, BoardPoint] {
  const endX = fretLine(lastFret);
  return [
    { x: 0, y: stringOffset(spec, stringNumber, 0) },
    { x: endX, y: stringOffset(spec, stringNumber, endX) },
  ];
}

/** The outline of the visible part of the board, for drawing. */
export function boardOutline(spec: GuitarSpec, lastFret: number): BoardPoint[] {
  const endX = fretLine(lastFret);
  const halfEnd = halfWidthAt(spec, endX);
  const halfNut = halfWidthAt(spec, 0);
  return [
    { x: 0, y: -halfNut },
    { x: endX, y: -halfEnd },
    { x: endX, y: halfEnd },
    { x: 0, y: halfNut },
  ];
}

/**
 * The reverse: a point somewhere on the board, read as a string and a fret.
 *
 * The string comes back fractional on purpose — "string 4.5" means a fingertip
 * sitting between two strings, and that half is exactly the error a judge
 * needs. The fret comes back as the whole box the point falls in, because a
 * fret *is* a box: anywhere between the two wires plays the same note.
 */
export interface BoardPosition {
  /** 1 (thin E) to 6 (thick E), fractional. */
  string: number;
  /** The box the point falls in: 0 is behind the nut, 1 is the first fret. */
  fret: number;
  /** The continuous fret coordinate, where 2.0 sits exactly on the 2nd wire. */
  wire: number;
}

export function positionOf(spec: GuitarSpec, point: BoardPoint): BoardPosition {
  // Invert the fret formula: x = 1 - 2^(-n/12). Clamped short of the bridge,
  // where the logarithm runs away.
  const clampedX = Math.min(0.98, Math.max(0, point.x));
  const wire = -12 * Math.log2(1 - clampedX);

  const usable = halfWidthAt(spec, clampedX) * (1 - EDGE_MARGIN);
  const across = usable === 0 ? 0 : point.y / usable;
  const stringNumber = across * ((STRING_COUNT - 1) / 2) + (STRING_COUNT + 1) / 2;

  return { string: stringNumber, fret: Math.max(0, Math.ceil(wire - 1e-9)), wire };
}
