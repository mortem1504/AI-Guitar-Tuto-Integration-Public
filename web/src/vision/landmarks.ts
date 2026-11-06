/**
 * Landmark indices and small geometry helpers.
 *
 * MediaPipe returns 21 points per hand, always in the same order. Naming them
 * here keeps every other file free of magic numbers.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * A landmark in real space. The model returns these alongside the flat ones,
 * in metres, with the origin at the middle of the hand. They are what makes
 * anything measured here independent of how the hand is turned.
 */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export const WRIST = 0;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const MIDDLE_MCP = 9;
export const RING_MCP = 13;
export const PINKY_MCP = 17;

/** Tip and middle joint of each long finger, from index to pinky. */
export const LONG_FINGERS = [
  { tip: 8, pip: 6, mcp: 5 },
  { tip: 12, pip: 10, mcp: 9 },
  { tip: 16, pip: 14, mcp: 13 },
  { tip: 20, pip: 18, mcp: 17 },
] as const;

export const FINGERTIPS = [THUMB_TIP, 8, 12, 16, 20] as const;

/** The five knuckles that form the palm, used to find its centre. */
export const PALM = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP] as const;

/** Which points connect to which, for drawing the hand skeleton. */
export const BONES: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distance3(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The angle at `vertex`, in degrees, between the two points either side of it.
 *
 * This is what tells a straight finger from a curled one. A straight finger has
 * its knuckle at nearly 180 degrees, and that stays true whichever way the hand
 * is facing — unlike anything measured on the flat image, which shortens as
 * soon as the hand turns away from the lens.
 */
export function angleAt(a: Point3, vertex: Point3, b: Point3): number {
  const ax = a.x - vertex.x;
  const ay = a.y - vertex.y;
  const az = a.z - vertex.z;
  const bx = b.x - vertex.x;
  const by = b.y - vertex.y;
  const bz = b.z - vertex.z;

  const lengths = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  if (lengths === 0) return 180;

  const cosine = (ax * bx + ay * by + az * bz) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

export function centroid(points: Point[], indices: readonly number[]): Point {
  let x = 0;
  let y = 0;
  for (const i of indices) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / indices.length, y: y / indices.length };
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Rescale a value from one range to another, clamped at both ends. */
export function remap(value: number, inLow: number, inHigh: number, outLow: number, outHigh: number): number {
  const t = clamp((value - inLow) / (inHigh - inLow), 0, 1);
  return outLow + t * (outHigh - outLow);
}
