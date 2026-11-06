/**
 * The note detector, on the audio thread.
 *
 * A thin wrapper: every render quantum's samples go into `NoteDetector`, and
 * whatever it decides goes to the main thread over the port. All the logic is
 * in `dsp/detector.ts`, which is pure and is what `npm run note-check`
 * measures; this file only exists because an AudioWorklet has to be one.
 *
 * Nothing is written to the outputs. The node is created with no outputs at
 * all, so the microphone has no path to the speakers, which is a privacy
 * promise and also what makes feedback with a guitar amp impossible.
 */

import { NoteDetector } from "../dsp/detector";
import { PARAMS } from "../params";

// The AudioWorkletGlobalScope's names. They are declared here, inside this
// module, rather than globally, so that main-thread code cannot use
// `sampleRate` by accident and compile.
declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class NoteProcessor extends AudioWorkletProcessor {
  private detector: NoteDetector | null = null;

  process(inputs: Float32Array[][]): boolean {
    const samples = inputs[0]?.[0];
    // No input connected yet, or the stream ended: nothing to do, keep alive.
    if (!samples) return true;

    // Created on the first block so its clock starts at the real currentFrame:
    // every time it reports is then AudioContext.currentTime.
    this.detector ??= new NoteDetector(sampleRate, PARAMS, (message) => this.port.postMessage(message), currentFrame);
    this.detector.push(samples);
    return true;
  }
}

registerProcessor("note-processor", NoteProcessor);
