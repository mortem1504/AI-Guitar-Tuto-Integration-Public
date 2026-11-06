/**
 * Turning 21 points into a gesture.
 *
 * Four things matter for playing: how many fingers are straight, where the hand
 * is, how far it leans, and how open it is.
 *
 * The first and last are measured on the model's *real-space* landmarks, in
 * metres, rather than on the flat image. That distinction is the whole reason
 * this works when you turn your hand: on the flat image a hand seen edge-on has
 * short fingers whether they are straight or curled, so anything measured there
 * falls apart the moment you rotate. In real space, a straight finger has a
 * straight knuckle from every angle.
 *
 * Position and lean stay on the flat image on purpose — those are about where
 * the hand is on the screen you are looking at.
 */

import {
  angleAt,
  centroid,
  distance,
  distance3,
  FINGERTIPS,
  LONG_FINGERS,
  MIDDLE_MCP,
  PALM,
  PINKY_MCP,
  remap,
  THUMB_IP,
  THUMB_TIP,
  WRIST,
  type Point,
  type Point3,
} from "./landmarks";
import type { HandReading, Side } from "./types";

/**
 * How straight a knuckle has to be to count as extended, in degrees.
 *
 * Two thresholds rather than one: a finger has to pass the higher angle to
 * count as up, and drop below the lower one to count as down. Without that gap
 * a finger resting near the boundary flickers, and a flickering finger is a
 * flickering chord.
 */
const EXTEND_ABOVE = 136;
const RETRACT_BELOW = 122;

/** The thumb folds sideways, so it is judged by how far it sits from the palm. */
const THUMB_OUT_ABOVE = 1.05;
const THUMB_IN_BELOW = 0.98;

export interface ReadHandInput {
  /** Landmarks on the image, smoothed. Used for position and lean. */
  points: Point[];
  /** The same landmarks in real space. Used for anything about finger shape. */
  world: Point3[];
  /** The handedness label the model reported. */
  rawSide: string;
  confidence: number;
  id: number;
  /** What each finger was doing last frame, for the hysteresis above. */
  previous?: boolean[];
}

export function readHand({ points, world, rawSide, confidence, id, previous }: ReadHandInput): HandReading {
  const wrist = points[WRIST];
  const palm = centroid(points, PALM);

  // A finger is straight when its middle knuckle is nearly flat. Which way the
  // hand is facing does not enter into it.
  const longFingers = LONG_FINGERS.map((finger, i) => {
    const angle = angleAt(world[finger.mcp], world[finger.pip], world[finger.tip]);
    const wasUp = previous?.[i] ?? false;
    return angle > (wasUp ? RETRACT_BELOW : EXTEND_ABOVE);
  });
  const longFingerCount = longFingers.filter(Boolean).length;

  // The thumb does not curl like the others; it swings in and out. Measuring it
  // against the far side of the palm separates those two cleanly.
  const thumbReach = distance3(world[THUMB_TIP], world[PINKY_MCP]) / (distance3(world[THUMB_IP], world[PINKY_MCP]) || 1e-6);
  const thumbWasOut = previous?.[4] ?? false;
  const thumb = thumbReach > (thumbWasOut ? THUMB_IN_BELOW : THUMB_OUT_ABOVE);

  // Lean: the direction from the wrist to the middle knuckle, on screen.
  // Pointing straight up gives 0, leaning left gives negative degrees.
  const dx = points[MIDDLE_MCP].x - wrist.x;
  const dy = points[MIDDLE_MCP].y - wrist.y;
  const tilt = (Math.atan2(dx, -dy) * 180) / Math.PI;

  // Openness: how far the fingertips sit from the middle of the hand, measured
  // against the hand's own size so distance from the camera does not matter.
  const worldPalm = centroid3(world, PALM);
  const handSize = distance3(world[WRIST], world[MIDDLE_MCP]) || 1e-6;
  const spread = FINGERTIPS.reduce((total, i) => total + distance3(world[i], worldPalm), 0) / FINGERTIPS.length / handSize;
  const openness = remap(spread, 0.6, 1.5, 0, 1);

  // The preview is not mirrored here, so the model's label already describes
  // the real hand: its "Left" is the student's left hand.
  const side: Side = rawSide === "Left" ? "left" : "right";

  return {
    id,
    side,
    points,
    palm,
    longFingers,
    longFingerCount,
    thumb,
    fingerCount: longFingerCount + (thumb ? 1 : 0),
    tilt,
    openness,
    confidence,
  };
}

function centroid3(points: Point3[], indices: readonly number[]): Point3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of indices) {
    x += points[i].x;
    y += points[i].y;
    z += points[i].z;
  }
  return { x: x / indices.length, y: y / indices.length, z: z / indices.length };
}

/** The five booleans to remember for next frame's hysteresis. */
export function extensionState(hand: HandReading): boolean[] {
  return [...hand.longFingers, hand.thumb];
}

/** Kept for the case where the model gives no real-space landmarks. */
export function flatFallback(points: Point[]): Point3[] {
  return points.map((p) => ({ x: p.x, y: p.y, z: 0 }));
}

export { distance };
