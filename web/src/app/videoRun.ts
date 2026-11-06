/**
 * Running the camera pipeline over a recorded video, for the evaluation.
 *
 *   http://localhost:3004/?debug&video=/local-videos/<file>.mp4&at=30
 *
 * The file plays muted in place of the camera (`HandTracker`'s `videoFile`),
 * from `at` seconds, and everything downstream is the app as a student gets
 * it: tracking, smoothing, the neck tracker, `FretReader`. For every new video
 * frame this records what the fretting hand's fingertips were read as, keyed
 * by the video's own clock so it can be lined up with a ground truth taken
 * from the same file. `window.__videoRun` holds the samples; `[video] done`
 * goes to the console at the end.
 *
 * Videos live in `web/local-videos/` (gitignored, outside `public/`, so a
 * build never ships one); Vite's dev server serves it. Debug only.
 */

import type { Fretboard } from "../guitar/Fretboard";
import type { NeckReading } from "../guitar/FretReader";
import { LONG_FINGERS } from "../vision/landmarks";

/**
 * One on-board fingertip: finger (1 index … 4 pinky), held string and fret,
 * the raw fractional string and wire, then the same two for the joint behind
 * the tip (DIP): the pad that presses the string lies between the two.
 */
export type TipSample = [number, number, number, number, number, number, number];

export interface VideoSample {
  /** Seconds on the video's clock. */
  t: number;
  /** Null when there was no neck or no fretting hand. */
  tips: TipSample[] | null;
}

const LOCAL_VIDEO = /^\/local-videos\/[^/?#\\]+\.(mp4|webm|mov|m4v)$/i;

/** The file named by `?video=`, or null: only a file in `local-videos/`, nothing else. */
export function localVideo(query: URLSearchParams): string | null {
  const path = query.get("video");
  if (!path || !LOCAL_VIDEO.test(path)) return null;
  const at = Number(query.get("at"));
  return Number.isFinite(at) && at > 0 ? `${path}#t=${at}` : path;
}

export class VideoRun {
  readonly samples: VideoSample[] = [];
  done = false;
  private lastTime = -1;

  constructor(private video: HTMLVideoElement) {
    video.addEventListener("ended", () => {
      this.done = true;
      const withHand = this.samples.filter((sample) => sample.tips && sample.tips.length > 0).length;
      console.info(`[video] done: ${this.samples.length} frames, ${withHand} with fingertips on the neck`);
    });
    (window as unknown as { __videoRun: VideoRun }).__videoRun = this;
  }

  /** Called every animation frame; records once per new video frame. */
  frame(reading: NeckReading | null, board: Fretboard | null) {
    const t = this.video.currentTime;
    if (this.done || t === this.lastTime) return;
    this.lastTime = t;
    const tips =
      reading && board
        ? reading.fingers
            .filter((finger) => finger.onBoard)
            .map((finger): TipSample => {
              // DIP is the joint before the tip: landmark tip - 1.
              const dip = board.positionAt(reading.hand.points[LONG_FINGERS[finger.finger - 1].tip - 1]);
              return [finger.finger, finger.string, finger.fret, round(finger.position.string), round(finger.position.wire), round(dip.string), round(dip.wire)];
            })
        : null;
    this.samples.push({ t: round(t), tips });
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000;
