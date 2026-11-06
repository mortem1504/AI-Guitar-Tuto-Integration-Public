/**
 * What the fretting hand is actually pressing.
 *
 * The hand tracker gives twenty-one points floating in the picture; the
 * fretboard turns any picture point into a string and a fret. This class joins
 * the two and answers, every frame: where are the four fingers, and which of
 * them are on the neck at all.
 *
 * Two honest limitations, both of which the tolerance setting exists to absorb:
 *
 *   - **The projection assumes the fingertip is on the board.** It is not: it
 *     sits a few millimetres above the wood, on top of a string. Seen from an
 *     angle, that height shifts where it lands — the further off-axis the
 *     camera, the further off. A camera roughly facing the neck keeps the error
 *     well under half a string.
 *   - **The landmark is the tip, not the pad.** A finger presses with the pad
 *     just behind the tip, so every reading leans very slightly towards the
 *     fingernail. It is a constant bias rather than noise, and small enough to
 *     leave alone rather than to correct with a fudge factor.
 *
 * Everything discrete goes through a Steady, for the same reason the gesture
 * instrument this grew out of needed one: a value that flickers between two
 * frames is worse than useless when a student is reading it as a verdict.
 */

import { Steady } from "../util/Steady";
import { LONG_FINGERS, type Point } from "../vision/landmarks";
import type { HandReading, Side } from "../vision/types";
import type { Handedness } from "../app/settings";
import type { Fretboard } from "./Fretboard";
import type { BoardPosition } from "./geometry";

/** Fingers as guitarists count them: 1 index, 4 pinky. The thumb is not one. */
export type FingerNumber = 1 | 2 | 3 | 4;

export interface FingerReading {
  finger: FingerNumber;
  /** Where the tip is in the picture, for drawing. */
  camera: Point;
  /** Where that lands on the instrument, fractional. */
  position: BoardPosition;
  /** The settled whole numbers: what this finger is being taken to press. */
  string: number;
  fret: number;
  /** False when the finger is off the neck — resting, muting, or in the air. */
  onBoard: boolean;
}

export interface NeckReading {
  hand: HandReading;
  fingers: FingerReading[];
}

/** Which hand frets: a right-handed guitar is fretted with the left hand. */
export function frettingSide(handedness: Handedness): Side {
  return handedness === "right" ? "left" : "right";
}

export class FretReader {
  /** One per finger, keyed "string:fret", so a reading has to hold to count. */
  private settled = new Map<FingerNumber, Steady<string>>();

  setFramesNeeded(frames: number) {
    for (const steady of this.settled.values()) steady.setFramesNeeded(frames);
  }

  /**
   * Picks the fretting hand out of what the camera sees.
   *
   * The handedness setting decides it when the model's label agrees. When it
   * does not — and it flickers exactly when a hand turns side-on, which is what
   * a fretting hand does constantly — the hand with more fingers over the neck
   * wins. Asking the picture beats trusting a label that is wrong precisely
   * when it matters.
   */
  pick(hands: HandReading[], board: Fretboard, handedness: Handedness): HandReading | null {
    if (hands.length === 0) return null;
    if (hands.length === 1) return hands[0];

    const wanted = frettingSide(handedness);
    const byLabel = hands.filter((hand) => hand.side === wanted);
    if (byLabel.length === 1) return byLabel[0];

    let best: HandReading | null = null;
    let bestCount = -1;
    for (const hand of hands) {
      const count = LONG_FINGERS.reduce(
        (total, finger) => total + (board.covers(hand.points[finger.tip]) ? 1 : 0),
        0,
      );
      if (count > bestCount) {
        bestCount = count;
        best = hand;
      }
    }
    return best;
  }

  /** Reads one hand's four fingers against the board. */
  read(hand: HandReading, board: Fretboard): NeckReading {
    const fingers: FingerReading[] = LONG_FINGERS.map((finger, index) => {
      const number = (index + 1) as FingerNumber;
      const camera = hand.points[finger.tip];
      const position = board.positionAt(camera);
      const onBoard = board.covers(camera);

      // Off the board the reading is meaningless, so it is not allowed to
      // stick: the Steady is fed a value that can never match a real one,
      // which lets the finger come back cleanly when it returns.
      const key = onBoard ? `${Math.round(position.string)}:${position.fret}` : "off";
      const steady = this.steadyFor(number);
      const held = steady.push(key);

      const [heldString, heldFret] = held === "off" ? [0, -1] : held.split(":").map(Number);

      return {
        finger: number,
        camera,
        position,
        string: heldString,
        fret: heldFret,
        onBoard: held !== "off",
      };
    });

    return { hand, fingers };
  }

  /** Forgets what it was holding — after a recalibration, or a lost hand. */
  reset() {
    for (const steady of this.settled.values()) steady.reset("off");
  }

  private steadyFor(finger: FingerNumber): Steady<string> {
    let steady = this.settled.get(finger);
    if (!steady) {
      steady = new Steady<string>("off", 4);
      this.settled.set(finger, steady);
    }
    return steady;
  }
}
