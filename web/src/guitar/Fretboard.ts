/**
 * The bridge between the guitar and the picture of it.
 *
 * `geometry.ts` knows where every fret is on a fretboard. `homography.ts` knows
 * how a flat plane looks through a lens. This class holds the two together and
 * answers the only two questions the rest of the app ever asks:
 *
 *   - Where on screen should this finger go?  (board → camera)
 *   - What is this fingertip pressing?        (camera → board)
 *
 * It is built from the four corners of the fretboard, in camera coordinates —
 * whether a student clicked them or the detector found them. Nothing else in
 * the app needs to know which of the two it was.
 */

import { applyHomography, homographyFrom, invert, quadArea, type Matrix3 } from "../vision/homography";
import type { Point } from "../vision/landmarks";
import {
  boardOutline,
  boardPoint,
  fretLine,
  fretWire,
  halfWidthAt,
  stringOffset,
  positionOf,
  stringLine,
  STRING_COUNT,
  type BoardPoint,
  type BoardPosition,
  type GuitarSpec,
} from "./geometry";

/**
 * The four corners, in the order the student is asked for them:
 * nut/thick-E, nut/thin-E, 12th/thin-E, 12th/thick-E — going around the
 * quadrilateral rather than criss-crossing it, so a half-finished calibration
 * still draws as a sensible shape.
 */
export type Corners = [Point, Point, Point, Point];

/**
 * What the four corners are actually on.
 *
 * A student clicking the corners of the fretboard marks the *edge of the wood*.
 * The detector, which finds the neck by finding the strings, can only report
 * where the outer strings run, and those sit a few millimetres inside the wood.
 * Three millimetres is a third of a string spacing: small enough to be
 * invisible, large enough to bias every judgement outwards. Exactly the kind of
 * difference that has to be said out loud in a type rather than absorbed.
 */
export type CornerKind = "edges" | "strings";

/** A quadrilateral this thin is a mis-click, not a neck. */
const MIN_AREA = 0.004;

export class Fretboard {
  private constructor(
    readonly spec: GuitarSpec,
    readonly corners: Corners,
    /** Which fret the far pair of corners sits on. Normally the 12th. */
    readonly farFret: number,
    readonly cornersAt: CornerKind,
    private readonly toImage: Matrix3,
    private readonly toBoardMatrix: Matrix3,
  ) {}

  /**
   * Builds one, or returns null if those four points cannot describe a neck.
   * The corners are given in camera coordinates (0..1 across the frame).
   *
   * `farFret` exists for the automatic detector, which finds whichever fret
   * happens to be the last one it can see rather than the one a student was
   * asked to click. The maths does not care which fret it is, only that it
   * knows — so the detector says, instead of pretending it found the 12th.
   *
   * `nearFret` is the same for the other end: a laptop camera often cannot
   * see the headstock, and a nut that is off the picture cannot be clicked
   * (BITACORA 2026-11-05: a student clicked round one fret box instead, and
   * got a grid squeezed into it). Marked on a fret wire, the board is still
   * known, so it is built from that and its `corners` are then where the nut
   * *would* be — off the picture, which nothing here minds — so everything
   * downstream (tracking, storage) keeps speaking nut-to-`farFret`.
   */
  static from(
    spec: GuitarSpec,
    corners: Corners,
    farFret = 12,
    cornersAt: CornerKind = "edges",
    nearFret = 0,
  ): Fretboard | null {
    if (quadArea(corners) < MIN_AREA || !(nearFret >= 0 && nearFret < farFret)) return null;

    const board = Fretboard.boardCorners(spec, nearFret, farFret, cornersAt);
    const toImage = homographyFrom(board, corners);
    if (!toImage) return null;
    const toBoardMatrix = invert(toImage);
    if (!toBoardMatrix) return null;

    const atNut = nearFret === 0 ? corners : (Fretboard.boardCorners(spec, 0, farFret, cornersAt).map((point) => applyHomography(toImage, point)) as Corners);
    return new Fretboard(spec, atNut, farFret, cornersAt, toImage, toBoardMatrix);
  }

  /**
   * Where those four corners sit on the real instrument. The 12th fret is at
   * exactly half the scale length, which is what makes it the landmark worth
   * asking for: it is unambiguous, it is marked with a double dot on almost
   * every guitar, and it is far enough from the nut for the two to pin down
   * the perspective properly.
   */
  private static boardCorners(spec: GuitarSpec, nearFret: number, farFret: number, cornersAt: CornerKind): BoardPoint[] {
    const nearX = fretLine(nearFret);
    const farX = fretLine(farFret);
    const across = (x: number) => (cornersAt === "edges" ? halfWidthAt(spec, x) : stringOffset(spec, 6, x));
    const atNear = across(nearX);
    const atFar = across(farX);
    return [
      { x: nearX, y: atNear }, // nut (or the near fret), thick E
      { x: nearX, y: -atNear }, // nut (or the near fret), thin E
      { x: farX, y: -atFar }, // far fret, thin E
      { x: farX, y: atFar }, // far fret, thick E
    ];
  }

  /** Board coordinates to a point in the camera's picture. */
  toCamera(point: BoardPoint): Point {
    return applyHomography(this.toImage, point);
  }

  /** A point in the camera's picture back onto the board. */
  toBoard(point: Point): BoardPoint {
    return applyHomography(this.toBoardMatrix, point);
  }

  /** What a point in the picture is pressing: a string and a fret. */
  positionAt(point: Point): BoardPosition {
    return positionOf(this.spec, this.toBoard(point));
  }

  /** Where a given string and fret should be touched, on screen. */
  pointFor(stringNumber: number, fret: number): Point {
    return this.toCamera(boardPoint(this.spec, stringNumber, fret));
  }

  /** True when a picture point falls on the fretboard at all. */
  covers(point: Point, slack = 0.15): boolean {
    const board = this.toBoard(point);
    const half = halfWidthAt(this.spec, Math.max(0, board.x)) * (1 + slack);
    return board.x > -0.02 && board.x < 0.75 && Math.abs(board.y) <= half;
  }

  /** The outline of the visible neck, in camera coordinates, for drawing. */
  outline(lastFret: number): Point[] {
    return boardOutline(this.spec, lastFret).map((point) => this.toCamera(point));
  }

  /** Every fret wire from the nut to `lastFret`, in camera coordinates. */
  fretLines(lastFret: number): [Point, Point][] {
    const lines: [Point, Point][] = [];
    for (let fret = 0; fret <= lastFret; fret++) {
      const [a, b] = fretWire(this.spec, fret);
      lines.push([this.toCamera(a), this.toCamera(b)]);
    }
    return lines;
  }

  /** Every string from the nut to `lastFret`, in camera coordinates. */
  stringLines(lastFret: number): [Point, Point][] {
    const lines: [Point, Point][] = [];
    for (let stringNumber = 1; stringNumber <= STRING_COUNT; stringNumber++) {
      const [a, b] = stringLine(this.spec, stringNumber, lastFret);
      lines.push([this.toCamera(a), this.toCamera(b)]);
    }
    return lines;
  }
}
