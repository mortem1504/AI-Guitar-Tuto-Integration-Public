/**
 * What the camera side offers a note session (App provides it while the
 * camera runs): whether vision can be trusted now, and where a note heard at
 * a given moment was played. Times on the page clock (performance.now()).
 */

import type { FeedbackState, Place } from "../lesson/noteJudge";
import type { VisionReason } from "./visionHealth";

export interface VisionLink {
  reason(nowPerfMs: number): VisionReason;
  placeOf(midi: number, atPerfMs: number): Place;
}

/** A note on the neck for the overlay: its state picks the colour. */
export interface PlacedNote {
  state: FeedbackState;
  place: { string: number; fret: number } | null;
}
