/**
 * Microphone → AudioWorklet → note events, and nothing else.
 *
 * The graph is two nodes: the stream source and the note processor, which has
 * no outputs. Nothing is connected to `context.destination`, so the guitar is
 * never played back (no feedback, nothing to hear but the guitar itself) and
 * nothing is recorded: the samples exist only inside the worklet's ring
 * buffer, a few hundred milliseconds of it, overwritten as it goes. The one
 * thing that does reach the speakers is the count-in click (`click`), made
 * here from an oscillator, never from the input.
 *
 * Opened when something asks to listen and closed when it stops — tracks
 * stopped, context closed — so the browser's recording indicator is an
 * honest account of when the app is listening.
 */

import type { DetectorMessage } from "./dsp/detector";
import { inputOf, openMicrophone } from "./mic";
import { NoteEvents, type ListenEvent } from "./noteEvents";
import processorUrl from "./worklet/note-processor.ts?worker&url";

export interface Arrival {
  /** `performance.now()` when the message reached the main thread. */
  perfMs: number;
  /** `AudioContext.currentTime` at that moment. */
  contextTime: number;
}

/** The test hook `?debug&source=synth` uses this to feed a known signal. */
export type SourceFactory = (context: AudioContext) => AudioNode;

export class NoteListener {
  private context: AudioContext | null = null;
  /** Bumped by every stop(): a start() still opening when it changes was cancelled. */
  private attempt = 0;
  private stream: MediaStream | null = null;
  private source: AudioNode | null = null;
  private node: AudioWorkletNode | null = null;
  private events = new NoteEvents();
  private handler: (event: ListenEvent, arrival: Arrival) => void = () => {};

  get listening(): boolean {
    return this.node !== null;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  /** The browser's estimate of its own processing delay, in ms. Excludes the hardware. */
  get baseLatencyMs(): number {
    return (this.context?.baseLatency ?? 0) * 1000;
  }

  /** The audio clock, in ms: the clock onsets are stamped with and clicks are scheduled on. */
  nowMs(): number {
    return (this.context?.currentTime ?? 0) * 1000;
  }

  /** The browser's estimate of the delay from scheduling a sound to hearing it, in ms. */
  get outputLatencyMs(): number {
    return (this.context?.outputLatency ?? 0) * 1000;
  }

  /**
   * A count-in click at `atMs` on the audio clock: 25 ms of a 1 kHz tone
   * (1.6 kHz on the first beat), the app's only sound. Played straight to the
   * speakers from an oscillator; the microphone's path is untouched and still
   * ends in the output-less processor. Only used with a plugged-in input: a
   * built-in microphone would hear the click, so that count-in is visual.
   */
  click(atMs: number, accent: boolean) {
    const context = this.context;
    if (!context) return;
    const at = Math.max(context.currentTime, atMs / 1000);
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.25, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.025);
    tone.connect(gain).connect(context.destination);
    tone.start(at);
    tone.stop(at + 0.03);
    tone.onended = () => gain.disconnect();
  }

  /** Which input the browser actually opened, which may differ from the one asked for. */
  get deviceId(): string | null {
    return this.stream ? inputOf(this.stream) : null;
  }

  onEvent(handler: (event: ListenEvent, arrival: Arrival) => void) {
    this.handler = handler;
  }

  static supported(): boolean {
    return typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Opens the microphone (or `synthetic`, for testing) and starts listening.
   * Throws if the microphone is refused; the caller says so.
   */
  async start(deviceId: string | null, synthetic?: SourceFactory): Promise<void> {
    this.stop();
    const attempt = this.attempt;

    const stream = synthetic ? null : await openMicrophone(deviceId);
    // "interactive" asks for the smallest buffers the platform offers.
    const context = new AudioContext({ latencyHint: "interactive" });
    const release = () => {
      stream?.getTracks().forEach((track) => track.stop());
      void context.close();
    };
    try {
      await context.resume();
      await context.audioWorklet.addModule(processorUrl);
    } catch (error) {
      release();
      throw error;
    }
    // stop() came while the microphone was opening (the tab was hidden, the
    // panel closed): release it instead of keeping it, with nobody listening.
    if (attempt !== this.attempt) {
      release();
      return;
    }

    const source = stream ? context.createMediaStreamSource(stream) : synthetic!(context);
    const node = new AudioWorkletNode(context, "note-processor", {
      numberOfInputs: 1,
      // No outputs: a sink. It is processed without being connected onwards,
      // and there is no path from the microphone to the speakers.
      numberOfOutputs: 0,
      // Mono. A two-input interface with the guitar on one side is averaged,
      // which costs 6 dB and nothing else.
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    node.port.onmessage = (message: MessageEvent<DetectorMessage>) => {
      const arrival = { perfMs: performance.now(), contextTime: context.currentTime };
      const event = this.events.accept(message.data);
      if (event) this.handler(event, arrival);
    };
    source.connect(node);

    this.context = context;
    this.stream = stream;
    this.source = source;
    this.node = node;
    this.events.reset();
  }

  /** Releases the microphone, so the browser's recording light goes out. */
  stop() {
    this.attempt++;
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.node = null;
  }
}
