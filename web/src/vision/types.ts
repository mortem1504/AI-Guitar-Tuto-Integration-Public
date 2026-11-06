import type { Point } from "./landmarks";

/** Which hand this is: the student's own left or right hand. */
export type Side = "left" | "right";

/**
 * One hand, already interpreted. Everything here is normalised: coordinates run
 * from 0 to 1 across the frame, and every measurement is relative to the hand's
 * own size, so nothing changes when you move closer to the camera.
 */
export interface HandReading {
  /** Stable identity across frames, so state can be kept per hand. */
  id: number;
  side: Side;
  /** All 21 landmarks, smoothed, in the camera's own frame (0..1). */
  points: Point[];
  /** Centre of the palm. */
  palm: Point;
  /** Which of index, middle, ring and pinky are straight. */
  longFingers: boolean[];
  /** How many of those four are straight, from 0 to 4. */
  longFingerCount: number;
  /** Whether the thumb is held away from the palm. */
  thumb: boolean;
  /** Every straight finger including the thumb, from 0 to 5. Display only. */
  fingerCount: number;
  /** Degrees away from pointing straight up. Negative leans left. */
  tilt: number;
  /** 0 for a closed fist, 1 for a wide open hand. */
  openness: number;
  /** How sure the model is, from 0 to 1. */
  confidence: number;
}
