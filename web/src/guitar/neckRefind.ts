/**
 * Finding the neck again by its fret wires (`neckWires`) and inlays
 * (`neckInlays`), when `NeckFollower`'s kept pictures no longer know it: the
 * guitar moved a little and the light on it changed (a student's recording,
 * BITACORA 2026-11-06), and the grid was gone for good.
 */

import { applyHomography, type Matrix3 } from "../vision/homography";
import type { Grey } from "../vision/patches";
import { fretCentre, type GuitarSpec } from "./geometry";
import { barcode, fretShift, shiftMiss, shifted } from "./neckInlays";
import { lockMiss, lockToWires, movement, startsNear, type Box } from "./neckWires";

/** Hands are grown by this (working pixels) for a wire looked for along a lane: a fingertip's landmark is a pixel or two inside the finger. */
const WIRE_HAND_MARGIN = 3;
/**
 * A lost neck found by its wires is shown only once the next pass finds it
 * there too, within this long and this far (pixels, or a quarter of its 12th
 * fret box if more): the search asks many times a second, and a chance match
 * of the inlays once is not the guitar twice. It costs one pass, 66 ms.
 */
const CONFIRM_MS = 250;
const CONFIRM_PX = 2;

export class WireFinder {
  /** Passes the wires decided, since the neck was marked: for `?debug` and for measuring. */
  found = 0;
  /** Why the last search found nothing: for `?debug`. */
  miss = "";
  private spec: GuitarSpec | null = null;
  /** This guitar's pattern along the neck when it was marked (`neckInlays.barcode`). */
  private pattern: Float32Array | null = null;
  /** A lost neck found once, waiting for the next pass to find it again (`CONFIRM_MS`). */
  private pending: { h: Matrix3; at: number } | null = null;

  forget() {
    this.spec = null;
    this.pattern = null;
    this.pending = null;
    this.found = 0;
  }

  /** Records the guitar's pattern where `boardToFrame` says the neck is. */
  mark(frame: Grey, boardToFrame: Matrix3, spec: GuitarSpec, hands: readonly Box[]) {
    this.forget();
    this.spec = spec;
    // Read through the wires where they agree with the marking: a click a
    // pixel off would read the pattern a little across a fret space. Where
    // they do not, the lock jumped to the next wire, a fret out (from a
    // marking 0.4 of a fret off, a third of the time: the student's 36 s).
    const boxes = grown(hands, WIRE_HAND_MARGIN);
    const wires = lockToWires(frame, boardToFrame, spec, boxes)?.h;
    this.pattern = barcode(frame, wires && this.agree(wires, boardToFrame) ? wires : boardToFrame, spec, boxes);
  }

  /**
   * The neck by its wires, from the first of `seeds` that locks, reads as the
   * fret it was marked at, and that `fits` accepts. Once `lost`, starts also
   * come along the band near `last` (`startsNear`), and a find is returned
   * only when the next pass agrees (`CONFIRM_MS`).
   */
  find(frame: Grey, seeds: readonly (Matrix3 | null)[], last: Matrix3, lost: boolean, hands: readonly Box[], nowMs: number, fits: (h: Matrix3) => boolean): Matrix3 | null {
    if (!this.spec || !this.pattern) return null;
    const boxes = grown(hands, WIRE_HAND_MARGIN);
    const pending = this.pending && nowMs - this.pending.at <= CONFIRM_MS ? this.pending : null;
    this.pending = null;
    const starts = [pending?.h ?? null, ...seeds, ...(lost ? startsNear(frame, last, this.spec, boxes) : [])].filter((h): h is Matrix3 => h !== null);
    let refused = "";
    for (const start of starts) {
      const h = this.locked(frame, start, boxes);
      if (this.miss.startsWith("which fret")) refused = this.miss;
      if (!h || !fits(h)) continue;
      if (lost && !(pending && this.agree(pending.h, h))) {
        this.pending = { h, at: nowMs };
        this.miss = "wires, once";
        return null;
      }
      this.found++;
      this.miss = "";
      return h;
    }
    this.miss = `wires from ${starts.length} starts: ${refused || (this.miss === "wires" ? lockMiss : this.miss)}`;
    return null;
  }

  /** Locked onto the wires near `start`, and moved to the fret the pattern says (null if it says none). */
  private locked(frame: Grey, start: Matrix3, boxes: readonly Box[]): Matrix3 | null {
    const spec = this.spec!;
    const pattern = this.pattern!;
    let locked = lockToWires(frame, start, spec, boxes);
    this.miss = "wires";
    if (!locked) return null;
    const k = fretShift(barcode(frame, locked.h, spec, boxes), pattern);
    this.miss = `which fret (${shiftMiss})`;
    if (k === null) return null;
    if (k !== 0) {
      // The wires locked a fret or more out; move there and check again.
      locked = lockToWires(frame, shifted(locked.h, k), spec, boxes);
      if (!locked || fretShift(barcode(frame, locked.h, spec, boxes), pattern) !== 0) return null;
    }
    return locked.h;
  }

  /** Do two poses put the frets in the same place: within `CONFIRM_PX`, or a quarter of the 12th fret box? */
  private agree(a: Matrix3, b: Matrix3): boolean {
    if (!this.spec) return false;
    const p = applyHomography(b, { x: fretCentre(11), y: 0 });
    const q = applyHomography(b, { x: fretCentre(12), y: 0 });
    return movement(a, b, this.spec) <= Math.max(CONFIRM_PX, Math.hypot(p.x - q.x, p.y - q.y) / 4);
  }
}

function grown(boxes: readonly Box[], margin: number): Box[] {
  return boxes.map((box) => ({ x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin }));
}
