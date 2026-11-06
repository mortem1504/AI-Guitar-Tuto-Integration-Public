/**
 * Camera in, hands out.
 *
 * The model is MediaPipe Hands, which runs entirely inside the browser on the
 * GPU. Nothing is uploaded: the video never leaves the machine. The first load
 * fetches the model file (~8 MB) and the browser caches it from then on.
 *
 * Coordinates come out in the camera's own frame, unmirrored, because
 * everything downstream has to agree with the guitar in the picture.
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { centroid, PALM, type Point3 } from "./landmarks";
import { extensionState, flatFallback, readHand } from "./readHand";
import { HandSmootherPool } from "./smoothing";
import type { HandReading } from "./types";
import { ModelLoadError } from "./cameraError";

/** Copied out of node_modules by the `copy-wasm` script, so it works offline.
 *  Resolved against the app's base URL — the site is served from a subpath. */
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe`;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * How long a hand keeps playing after the model loses it. Detection drops for a
 * frame or two all the time — a blink of bad light, a hand turning edge on. If
 * the sound cut out every time, the instrument would stutter constantly.
 *
 * The grace is per hand: losing one of two — the everyday case in a difficult
 * two-hand transition — must not make the survivor swallow the other's role.
 */
const GRACE_MS = 220;

/**
 * Hands move at human speed: reading them ~30 times a second loses nothing
 * playable, and halves the model's cost — the single biggest CPU line in the
 * app. The camera itself keeps its native rate, so the picture on screen and
 * in recorded takes stays exactly as smooth as before. The interval follows
 * the Smoothness slider: its immediate third runs the model on every frame.
 */
const DEFAULT_INFERENCE_INTERVAL_MS = 30;

/** A hand must have lived this long to earn the grace — a one-frame phantom
 *  (a face, a mug) should not get to linger. */
const MIN_LIFE_MS = 150;

interface GraceEntry {
  reading: HandReading;
  seenAt: number;
  bornAt: number;
}

/**
 * Fills in briefly-missing hands from memory. Exported bare so the behaviour
 * can be exercised without a camera.
 */
export function withHandGrace(
  present: HandReading[],
  memory: Map<number, GraceEntry>,
  nowMs: number,
  capacity: number,
): HandReading[] {
  for (const reading of present) {
    const previous = memory.get(reading.id);
    // A slot idle long enough was reassigned to a new hand by the smoother
    // pool, so its life starts over.
    const bornAt = previous && nowMs - previous.seenAt <= 500 ? previous.bornAt : nowMs;
    memory.set(reading.id, { reading, seenAt: nowMs, bornAt });
  }

  const out = [...present];
  for (const [slot, entry] of memory) {
    if (present.some((reading) => reading.id === slot)) continue;
    if (nowMs - entry.seenAt >= GRACE_MS) {
      memory.delete(slot);
      continue;
    }
    if (entry.seenAt - entry.bornAt < MIN_LIFE_MS) continue;
    if (out.length < capacity) out.push(entry.reading);
  }
  return out;
}

export interface TrackerOptions {
  maxHands?: number;
  detectionConfidence?: number;
  trackingConfidence?: number;
  /**
   * `?debug&video=`: a recorded file plays in place of the camera, muted, so
   * the evaluation can run the real pipeline over videos (app/videoRun.ts).
   * A media-fragment URL (`…#t=30`) starts it partway.
   */
  videoFile?: string;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private lastInferenceAt = 0;
  private inferenceInterval = DEFAULT_INFERENCE_INTERVAL_MS;
  private smoothers = new HandSmootherPool(2);
  private grace = new Map<number, GraceEntry>();
  private lastOutput: HandReading[] = [];
  private frameTimes: number[] = [];
  /** Which fingers each tracked hand had up last frame, for the hysteresis. */
  private extensions = new Map<number, boolean[]>();

  /** Frames per second actually going through the model. */
  fps = 0;

  constructor(
    private video: HTMLVideoElement,
    private options: TrackerOptions = {},
  ) {}

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /**
   * How closely the landmarks follow the hand. Higher values react faster and
   * jitter more; lower ones glide. Retunes the filters already running.
   */
  setSmoothing(minCutoff: number, beta: number) {
    this.smoothers.tune(minCutoff, beta);
  }

  /** Minimum ms between model inferences; 0 runs on every camera frame. */
  setInferenceInterval(ms: number) {
    this.inferenceInterval = Math.max(0, ms);
  }

  /** Asks for the camera and loads the model. Throws if either is refused. */
  async start(): Promise<void> {
    if (this.options.videoFile) {
      this.video.muted = true;
      this.video.src = this.options.videoFile;
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = stream;
    }
    await this.video.play();

    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: this.options.maxHands ?? 2,
        minHandDetectionConfidence: this.options.detectionConfidence ?? 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: this.options.trackingConfidence ?? 0.5,
      });
    } catch (error) {
      // The camera worked; the model did not. Let the camera go, and say which.
      this.stop();
      throw new ModelLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Reads the current video frame. Safe to call more often than the camera runs. */
  read(nowMs: number): HandReading[] {
    if (!this.landmarker || this.video.readyState < 2) return [];

    // Feeding the same frame twice makes the model throw.
    if (this.video.currentTime === this.lastVideoTime) {
      return this.lastOutput;
    }
    // Between inferences the last reading stands. The One Euro filters carry
    // their own clocks, so a 30 Hz feed changes nothing about how they smooth.
    if (nowMs - this.lastInferenceAt < this.inferenceInterval) {
      return this.lastOutput;
    }
    this.lastVideoTime = this.video.currentTime;
    this.lastInferenceAt = nowMs;

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    this.trackFps(nowMs);

    // The field was renamed between releases of the package.
    const raw = result as unknown as {
      handedness?: { categoryName: string; score: number }[][];
      handednesses?: { categoryName: string; score: number }[][];
      worldLandmarks?: Point3[][];
    };
    const labels = raw.handedness ?? raw.handednesses ?? [];

    const claimed = new Set<number>();
    const readings: HandReading[] = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      // Deliberately not mirrored. A guitar has to be read the way the camera
      // sees it: mirroring would reverse the string order and turn every fret
      // number into its opposite. See BITACORA, F1.
      const raw2d = result.landmarks[i];
      const palm = centroid(raw2d, PALM);
      const { points, slot } = this.smoothers.smooth(raw2d, palm, nowMs, claimed);

      // Real-space landmarks are what make finger shape survive a turned hand.
      // If a build of the model ever stops providing them, the flat ones stand
      // in and everything still runs, just less reliably off-axis.
      const world = raw.worldLandmarks?.[i] ?? flatFallback(points);

      const reading = readHand({
        points,
        world,
        rawSide: labels[i]?.[0]?.categoryName ?? "Right",
        confidence: labels[i]?.[0]?.score ?? 1,
        id: slot,
        previous: this.extensions.get(slot),
      });
      this.extensions.set(slot, extensionState(reading));
      readings.push(reading);
    }

    // A hand the model just lost — one of two, or all of them — lingers from
    // memory for a moment, so a blink is never a cut and never a role change.
    this.lastOutput = withHandGrace(readings, this.grace, nowMs, this.options.maxHands ?? 2);
    return this.lastOutput;
  }

  private trackFps(nowMs: number) {
    this.frameTimes.push(nowMs);
    while (this.frameTimes.length > 30) this.frameTimes.shift();
    if (this.frameTimes.length > 1) {
      const span = this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0];
      if (span > 0) this.fps = Math.round(((this.frameTimes.length - 1) / span) * 1000);
    }
  }

  stop() {
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    if (this.options.videoFile) this.video.removeAttribute("src");
    this.landmarker?.close();
    this.landmarker = null;
    this.grace.clear();
    this.lastOutput = [];
  }
}
