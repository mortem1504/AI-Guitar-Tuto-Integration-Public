/**
 * A suggested fretting finger for every note of a song.
 *
 * The rule is the one teachers start beginners with: the hand sits in a
 * position covering four frets, one finger per fret, so the finger is
 * `fret - position + 1` (1 index … 4 pinky) and an open string needs none (0).
 * What is left to choose is where the hand sits for each note, and that is
 * picked over the whole song at once (a small dynamic programme) so the hand
 * moves as rarely, and as little, as it can.
 *
 * It is a suggestion, never "the correct" fingering: players with other
 * habits, or a teacher, may do better, and the UI says so.
 */

import type { Song, TabEvent, TabNote } from "./model";

/** A hand position: the fret under the index finger. The window is `position` … `position + 3`. */
export const SPAN = 4;

/** Highest index-finger fret: with 24 frets the pinky's window is 21-24. */
const MAX_POSITION = 21;

/**
 * Costs of moving the hand. Any shift costs 1, so fewer shifts always win;
 * each fret travelled adds a little, so between two equally few shifts the
 * shorter ones win.
 */
const SHIFT_COST = 1;
const SHIFT_PER_FRET = 0.1;

/**
 * Inside a window, lower fingers are slightly preferred: it settles ties
 * towards the index finger on the lowest fret played, the way positions are
 * taught ("fifth position" = index on the 5th fret).
 */
const FINGER_COST = 0.01;

/** A chord that does not fit in four frets is a stretch; this keeps it possible but last. */
const STRETCH_COST = 3;

export interface EventFingering {
  /** Where the index finger sits. Kept through open-string notes. */
  position: number;
  /** One per note of the event, in the event's order: 1-4 index…pinky, 0 when not pressed (see `pressed`). */
  fingers: number[];
  /** The hand moved to get here (from the last position used). */
  shift: boolean;
  /** Some note lies outside the four-fret window; its finger is the nearest one. */
  stretch: boolean;
}

export interface Fingering {
  events: EventFingering[];
  shifts: number;
  /** Always "suggested": the UI must never present it as the only right way. */
  label: "suggested";
}

/**
 * Whether the fretting hand presses this note down. Not for an open string,
 * a dead note (muted, any finger), a natural harmonic (touched over the wire,
 * not pressed) or a tapped note (the picking hand plays it): those get finger
 * 0 and do not move the hand.
 */
export function pressed(note: TabNote): boolean {
  return note.fret > 0 && !note.techniques.some((t) => t === "dead" || t === "harmonic" || t === "tap");
}

const fretted = (event: TabEvent) => event.notes.filter(pressed);

/** The cost of playing `event` with the hand at `position`; Infinity when it cannot. */
function placeCost(event: TabEvent, position: number): number {
  const frets = fretted(event).map((note) => note.fret);
  if (frets.length === 0) return 0;
  let cost = 0;
  for (const fret of frets) {
    const finger = fret - position + 1;
    if (finger < 1 || finger > SPAN) return Infinity;
    cost += (finger - 1) * FINGER_COST;
  }
  return cost;
}

function fingersAt(event: TabEvent, position: number): { fingers: number[]; stretch: boolean } {
  let stretch = false;
  const fingers = event.notes.map((note) => {
    if (!pressed(note)) return 0;
    const finger = note.fret - position + 1;
    if (finger < 1 || finger > SPAN) stretch = true;
    return Math.min(SPAN, Math.max(1, finger));
  });
  return { fingers, stretch };
}

export function suggestFingering(song: Song): Fingering {
  const events = song.events;
  if (events.length === 0) return { events: [], shifts: 0, label: "suggested" };
  const positions = MAX_POSITION; // positions 1..MAX_POSITION, index p-1
  // cost[i][p]: the cheapest way to play events 0..i ending at position p.
  const cost: Float64Array[] = [];
  const from: Int8Array[] = [];
  for (let i = 0; i < events.length; i++) {
    const row = new Float64Array(positions).fill(Infinity);
    const back = new Int8Array(positions).fill(-1);
    const place = Array.from({ length: positions }, (_, p) => placeCost(events[i], p + 1));
    // A chord wider than four frets fits nowhere: let it sit at its lowest fret, as a stretch.
    if (place.every((c) => c === Infinity)) {
      const lowest = Math.min(...fretted(events[i]).map((note) => note.fret));
      place[Math.min(positions, lowest) - 1] = STRETCH_COST;
    }
    for (let p = 0; p < positions; p++) {
      if (place[p] === Infinity) continue;
      if (i === 0) {
        row[p] = place[p];
        continue;
      }
      for (let q = 0; q < positions; q++) {
        const previous = cost[i - 1][q];
        if (previous === Infinity) continue;
        const move = p === q ? 0 : SHIFT_COST + Math.abs(p - q) * SHIFT_PER_FRET;
        const total = previous + move + place[p];
        // Ties go to the lower previous position, so the result never depends on loop quirks.
        if (total < row[p] - 1e-9) {
          row[p] = total;
          back[p] = q;
        }
      }
    }
    cost.push(row);
    from.push(back);
  }
  // Walk back from the cheapest end.
  let p = 0;
  for (let q = 1; q < positions; q++) if (cost[events.length - 1][q] < cost[events.length - 1][p] - 1e-9) p = q;
  const chosen = new Array<number>(events.length);
  for (let i = events.length - 1; i >= 0; i--) {
    chosen[i] = p + 1;
    if (i > 0) p = from[i][p];
  }
  // Open-string notes fit every position, so the walk-back may park the hand anywhere on
  // them; keep it where it was, so a shift is shown only where the hand really moves.
  // Open notes before the first fretted one wait where that one will be played.
  const firstFretted = events.findIndex((event) => fretted(event).length > 0);
  for (let i = 0; i < events.length; i++) {
    if (fretted(events[i]).length > 0) continue;
    chosen[i] = firstFretted === -1 ? 1 : i < firstFretted ? chosen[firstFretted] : chosen[i - 1];
  }

  let shifts = 0;
  let last: number | null = null;
  const out = events.map((event, i) => {
    const { fingers, stretch } = fingersAt(event, chosen[i]);
    const hasFretted = fretted(event).length > 0;
    const shift = hasFretted && last !== null && chosen[i] !== last;
    if (shift) shifts++;
    if (hasFretted) last = chosen[i];
    return { position: chosen[i], fingers, shift, stretch };
  });
  return { events: out, shifts, label: "suggested" };
}
