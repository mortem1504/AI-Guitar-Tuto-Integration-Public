/**
 * Remembering where the neck is.
 *
 * Marking the fretboard is the one piece of setup this class asks for, so it
 * has to survive a reload — nobody should click four corners every time they
 * pick the guitar up. Stored alongside the guitar it was measured on, because
 * the corners mean different physical widths on an acoustic and an electric,
 * and reading one as the other puts every string half a string out.
 *
 * As with every other stored value here, what comes back is treated as
 * hostile: four finite numbers in range, or nothing.
 */

import type { CornerKind, Corners } from "../guitar/Fretboard";
import type { Point } from "../vision/landmarks";
import { isGuitarKind, type GuitarKind } from "./settings";

const STORAGE_KEY = "guitar.calibration.v1";

export interface StoredCalibration {
  guitar: GuitarKind;
  corners: Corners;
  /** Which fret the far corners sit on — 12 when a student marked them. */
  farFret: number;
  /** Whether the corners are on the edge of the wood or on the outer strings. */
  cornersAt: CornerKind;
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    // Generous bounds: a corner can legitimately sit off frame, and a nut
    // worked out from a near pair marked on the 5th fret (Fretboard.from) can
    // sit more than a frame's width off it. Still finite and bounded.
    point.x > -4 &&
    point.x < 5 &&
    point.y > -4 &&
    point.y < 5
  );
}

export function loadCalibration(): StoredCalibration | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== "object" || stored === null) return null;

  const data = stored as Record<string, unknown>;
  if (!isGuitarKind(data.guitar)) return null;
  if (!Array.isArray(data.corners) || data.corners.length !== 4) return null;
  if (!data.corners.every(isPoint)) return null;

  const corners = data.corners.map((point) => ({ x: point.x, y: point.y })) as Corners;
  const farFret =
    typeof data.farFret === "number" && Number.isFinite(data.farFret)
      ? Math.min(17, Math.max(3, Math.round(data.farFret)))
      : 12;
  const cornersAt: CornerKind = data.cornersAt === "strings" ? "strings" : "edges";
  return { guitar: data.guitar, corners, farFret, cornersAt };
}

export function saveCalibration(calibration: StoredCalibration) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
  } catch {
    // Private browsing or a full quota. The class still works this session.
  }
}

export function clearCalibration() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do about it, and nothing worth interrupting anyone over.
  }
}
