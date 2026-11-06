/**
 * Making sense of four clicks, whatever order they arrived in.
 *
 * The calibration used to trust the student to click the corners in exactly the
 * order it asked for. That was a mistake, and a quiet one: click them going
 * around the fretboard instead — which is what "the four corners" invites — and
 * the homography maps the across-the-neck axis onto the along-the-neck one. The
 * grid still draws, the app still runs, and every chord comes out with its
 * fingers spread over three frets. Nothing announces that anything is wrong.
 *
 * So the order is worked out from the shape instead, and a neck is a shape that
 * gives it away:
 *
 *   - It is much longer than it is wide, so the two *short* sides of the
 *     quadrilateral are its ends and the long ones are its edges.
 *   - It tapers, so the shorter of the two ends is the nut.
 *
 * Only one thing genuinely cannot be recovered from the shape: which side is
 * the thick E. That is which way round the guitar is, not what shape it is, so
 * the first click is taken as the answer and the flip button exists for when it
 * was not.
 */

import type { Corners } from "./Fretboard";
import type { Point } from "../vision/landmarks";

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Puts four clicked points into the order the fretboard maths expects:
 * nut/thick-E, nut/thin-E, far/thin-E, far/thick-E, going around the quad.
 */
export function orderCorners(points: Corners): Corners {
  const centre = {
    x: (points[0].x + points[1].x + points[2].x + points[3].x) / 4,
    y: (points[0].y + points[1].y + points[2].y + points[3].y) / 4,
  };

  // Around the centre first. Any four points in angular order form a simple
  // quadrilateral, which is what stops a click order from folding it into a
  // bow tie — and a bow tie produces a homography that is nonsense rather than
  // merely rotated.
  const ring = [...points].sort(
    (a, b) => Math.atan2(a.y - centre.y, a.x - centre.x) - Math.atan2(b.y - centre.y, b.x - centre.x),
  );

  const sideLength = (i: number) => distance(ring[i], ring[(i + 1) % 4]);

  // Opposite sides pair up two ways. The ends are the pair that is shorter,
  // because a neck is long.
  const acrossFirst = (sideLength(0) + sideLength(2)) / 2;
  const acrossSecond = (sideLength(1) + sideLength(3)) / 2;
  const ends: [number, number] = acrossFirst <= acrossSecond ? [0, 2] : [1, 3];

  // Of the two ends, the narrower one is the nut: a fretboard widens towards
  // the body, and that taper is the only thing in four points that says which
  // end is which.
  const nutSide = sideLength(ends[0]) <= sideLength(ends[1]) ? ends[0] : ends[1];

  const ordered = [0, 1, 2, 3].map((step) => ring[(nutSide + step) % 4]) as Corners;

  // Which of the two nut points is the thick-E side cannot be read off the
  // shape. The student was asked for that one first, so it is honoured when it
  // is recognisable — and the flip button covers the rest.
  if (ordered[1] === points[0]) {
    return [ordered[1], ordered[0], ordered[3], ordered[2]];
  }
  return ordered;
}

/**
 * Whether four points could be a neck at all: long, thin, and not folded.
 * A quad this square is a mis-click — a table, a book, a phone on the bed.
 */
export function looksLikeNeck(corners: Corners): boolean {
  const long = (distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2;
  const short = (distance(corners[0], corners[1]) + distance(corners[2], corners[3])) / 2;
  if (short <= 0) return false;
  return long / short > 2.2;
}

/**
 * The least a hand-marked nut-to-12th quad may be longer than it is wide,
 * measured in camera pixels. Nut to 12th fret is half the scale: about 325 mm
 * on an acoustic, against a fretboard about 43-55 mm wide, so roughly 6.5 to 1
 * seen square on. 3 still lets the neck point well over 60° away from the
 * camera. It is stricter than `looksLikeNeck`'s 2.2 because a hand marking has
 * a known span, where the detector's quads do not.
 *
 * It catches the mistake in a real recording (2026-11-05): four clicks around
 * one fret box, the nut being off the edge of the picture. They came out 2.5
 * to 1 *the wrong way*, so the box's top and bottom edges were taken for the
 * nut and the 12th fret: the whole 0-12 grid squeezed into one fret, with its
 * frets running across the neck.
 */
export const MIN_MARKED_RATIO = 3;

/**
 * Whether four ordered corners, marked by hand, are too squat to be what was
 * asked for: null if they pass. `span` is how much of the scale length lies
 * between the two pairs — half, for the nut and the 12th fret; less when the
 * nut is off the picture and the near pair is on a fret — and the least
 * ratio shrinks with it (3rd to 12th: 2.0; 5th to 12th, the shortest the
 * calibrator allows, 1.5). Shrunk like that it no longer catches four clicks
 * round one fret box, which came out 2.5 to 1: it guards the nut-to-12th
 * marking, where that mistake was made because the nut could not be clicked.
 * A student who picks a near fret has the nut problem solved instead, and the
 * grid drawn live over the real wires shows a wrong span. Corners are in
 * camera coordinates (0-1 each way), so `aspect` (video width / height) turns
 * them into pixels before any length is compared.
 */
export function markingProblem(corners: Corners, aspect: number, span = 0.5): "tooClose" | null {
  if (!(aspect > 0) || !Number.isFinite(aspect) || !(span > 0)) return null;
  const px = corners.map((p) => ({ x: p.x * aspect, y: p.y }));
  const long = (distance(px[0], px[3]) + distance(px[1], px[2])) / 2;
  const short = (distance(px[0], px[1]) + distance(px[2], px[3])) / 2;
  if (short <= 0 || long / short < MIN_MARKED_RATIO * Math.min(1, span / 0.5)) return "tooClose";
  return null;
}
