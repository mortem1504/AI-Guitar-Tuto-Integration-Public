/**
 * The microphone, and what to do with what it hears.
 *
 * This is the only part of the app that opens an input the camera cannot
 * provide, and it is deliberately the smallest possible amount of audio code:
 * a stream, an analyser, and a buffer. There is no synthesis, no recording, no
 * file, and — importantly — **nothing is ever connected to the speakers**. The
 * microphone signal reaches the analyser and stops there, which is also what
 * makes a feedback loop impossible with a guitar sitting in front of a laptop.
 *
 * The stream is opened when the tuner is opened and released when it closes, so
 * the browser's recording indicator is an accurate account of what is
 * happening: on while tuning, off the rest of the time.
 */

import { detectPitch, type PitchReading } from "./pitch";

/**
 * Guitar processing, not call processing. Echo cancellation, noise suppression
 * and gain control all exist to make speech intelligible, and all three mangle
 * a sustained musical note — noise suppression in particular hears a steady
 * tone as exactly the kind of stationary signal it is designed to remove.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * How many samples each analysis sees. At 48 kHz this is ~43 ms, which holds
 * three and a half periods of the thick E — enough for the correlation to have
 * something to correlate, short enough that the needle follows the peg.
 */
const WINDOW = 2048;

/** Analyses per second. Sixty would be waste: a hand cannot turn a peg that fast. */
const ANALYSES_PER_SECOND = 20;

export class Tuner {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer = new Float32Array(WINDOW);
  private lastAnalysis = 0;
  /** Bumped by every stop(): a start() still opening when it changes was cancelled. */
  private attempt = 0;
  private lastReading: PitchReading | null = null;

  get listening(): boolean {
    return this.analyser !== null;
  }

  /** Asks for the microphone. Throws if it is refused — the caller says so. */
  async start(): Promise<void> {
    if (this.analyser) return;
    const attempt = this.attempt;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
    const context = new AudioContext();
    // Some browsers hand back a suspended context until a gesture; opening the
    // tuner is that gesture, so this resolves immediately in practice.
    await context.resume();
    // stop() came while the microphone was opening: release it, never keep it.
    if (attempt !== this.attempt) {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      return;
    }
    this.stream = stream;
    this.context = context;

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = WINDOW * 2;
    // Source into analyser and no further. Nothing downstream, ever.
    source.connect(analyser);
    this.analyser = analyser;
  }

  /** Releases the microphone, so the browser's recording light goes out. */
  stop() {
    this.attempt++;
    this.analyser?.disconnect();
    this.analyser = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.lastReading = null;
    this.lastAnalysis = 0;
  }

  /**
   * The pitch right now, or null for silence.
   *
   * Safe to call every animation frame: the analysis itself is throttled, and
   * between analyses the previous answer stands rather than flickering to null.
   */
  read(nowMs: number): PitchReading | null {
    const analyser = this.analyser;
    if (!analyser || !this.context) return null;

    if (nowMs - this.lastAnalysis < 1000 / ANALYSES_PER_SECOND) return this.lastReading;
    this.lastAnalysis = nowMs;

    analyser.getFloatTimeDomainData(this.buffer);
    this.lastReading = detectPitch(this.buffer, this.context.sampleRate);
    return this.lastReading;
  }
}
