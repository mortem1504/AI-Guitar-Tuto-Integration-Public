/**
 * Marking the chord.
 *
 * The rule that shapes this whole file: **"wrong" teaches nobody anything.**
 * A student who is told the chord is wrong has learnt only that they are stuck.
 * A student who is told "your ring finger is one string too low" has been given
 * the next move. So the judge never returns a verdict on the chord — it returns
 * one per finger, and lets the coach decide what to say first.
 *
 * The chord itself says which finger goes where, so there is no matching
 * problem to solve: the ring finger is judged against the place the ring finger
 * belongs. That is also what makes the diagnosis specific rather than a nearest-
 * neighbour guess that would happily report two fingers as "swapped".
 */

import type { ChordTarget, Placement } from "./chords";
import type { FingerNumber, FingerReading, NeckReading } from "./FretReader";

export type Verdict = "correct" | "wrongString" | "wrongFret" | "missing";

export interface FingerJudgement {
  /** Where the chord wants this finger. */
  placement: Placement;
  verdict: Verdict;
  /** What the camera saw for that finger, when it saw anything. */
  seen?: FingerReading;
}

export interface ChordJudgement {
  perFinger: FingerJudgement[];
  /** Fingers on the neck that the chord did not ask for. */
  extras: FingerReading[];
  /** True only when every finger the chord wants is where it wants it. */
  complete: boolean;
  rightCount: number;
  total: number;
}

/**
 * How much slack the judge gives, from the tolerance setting.
 *
 * Never zero, even at the strictest end. The homography has error, the
 * fingertip landmark is not the finger pad, and a fingertip is physically
 * wider than a string — demanding a perfect centre would fail a chord that a
 * teacher standing there would call clean.
 */
export function slackFor(tolerance: number): { string: number; fret: number } {
  const t = Math.min(1, Math.max(0, tolerance));
  return {
    // In string spacings. Half a spacing is the point where another string is
    // genuinely nearer, so the generous end stops short of it.
    string: 0.3 + t * 0.16,
    // In fret boxes, measured *outside* the box: a finger inside is always in.
    fret: 0.1 + t * 0.4,
  };
}

export function judge(target: ChordTarget, reading: NeckReading | null, tolerance: number): ChordJudgement {
  const slack = slackFor(tolerance);
  const wanted = new Map<FingerNumber, Placement>();
  for (const placement of target.placements) wanted.set(placement.finger, placement);

  const perFinger: FingerJudgement[] = target.placements.map((placement) => {
    const seen = reading?.fingers.find((finger) => finger.finger === placement.finger);
    if (!seen) return { placement, verdict: "missing" };
    return { placement, verdict: verdictFor(placement, seen, slack), seen };
  });

  const extras = (reading?.fingers ?? []).filter((finger) => finger.onBoard && !wanted.has(finger.finger));

  const rightCount = perFinger.filter((entry) => entry.verdict === "correct").length;
  return {
    perFinger,
    extras,
    complete: rightCount === perFinger.length && perFinger.length > 0,
    rightCount,
    total: perFinger.length,
  };
}

function verdictFor(placement: Placement, seen: FingerReading, slack: { string: number; fret: number }): Verdict {
  // A barre is judged differently on purpose. The index finger lies flat across
  // the neck and its *tip* sticks out past the thick E — off the fretboard
  // entirely — so the usual "is it on the board" test rejects a perfectly good
  // barre. What matters is the fret it lies across and that it reaches far
  // enough over, so that is what gets checked.
  if (placement.underBarre) {
    const reaches = seen.position.string >= placement.string - 0.6;
    const rightFret = fretMiss(placement.fret, seen.position.wire) <= slack.fret;
    if (reaches && rightFret) return "correct";
    return rightFret ? "wrongString" : "wrongFret";
  }

  if (!seen.onBoard) return "missing";

  const stringMiss = Math.abs(seen.position.string - placement.string);
  const missedFret = fretMiss(placement.fret, seen.position.wire);

  if (stringMiss <= slack.string && missedFret <= slack.fret) return "correct";
  // The fret is reported first when both are out: a finger in the wrong fret is
  // playing a different note, while a finger one string off within the right
  // fret is usually a hand that just needs to shift a little.
  if (missedFret > slack.fret) return "wrongFret";
  return "wrongString";
}

/**
 * How far outside its box a finger is, in boxes. Zero anywhere inside.
 *
 * The continuous fret coordinate is uniform in fret number by construction —
 * wire n sits at exactly n — so a box is one unit wide however far up the neck
 * it is, and one slack figure means the same thing everywhere.
 */
function fretMiss(fret: number, wire: number): number {
  const low = fret - 1;
  const high = fret;
  if (wire >= low && wire <= high) return 0;
  return wire < low ? low - wire : wire - high;
}

/**
 * The one thing worth saying right now.
 *
 * A student cannot act on four corrections at once, and a coach who lists them
 * all is a coach nobody listens to. Missing fingers come first — you cannot fix
 * a finger you have not put down — then wrong frets, then wrong strings.
 */
export function firstProblem(judgement: ChordJudgement): FingerJudgement | null {
  const order: Verdict[] = ["missing", "wrongFret", "wrongString"];
  for (const verdict of order) {
    const found = judgement.perFinger.find((entry) => entry.verdict === verdict);
    if (found) return found;
  }
  return null;
}
