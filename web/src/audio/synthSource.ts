/**
 * A known signal, for checking the live pipeline without a guitar.
 *
 * Only reachable with `?debug&source=synth` (or `source=exercise`, below). It plays a looping sequence of
 * synthesised plucks into the note processor *instead of* the microphone, so
 * the worklet, the event stream and the screen can be checked end to end on a
 * machine with no instrument (or a browser that refuses the microphone). Like
 * the microphone, it is connected to the processor and to nothing else: it is
 * never heard.
 *
 * The pluck is the same additive model as `scripts/lib/synth.mjs`, simplified.
 */

/** Open strings, then up the neck to the 24th fret's E6. */
export const SYNTH_SEQUENCE = [40, 45, 50, 55, 59, 64, 65, 72, 76, 88];
const NOTE_SECONDS = 0.7;

/** Adds one pluck of `midi`, `length` samples long, at `offset`. */
function pluck(data: Float32Array, offset: number, length: number, midi: number, rate: number) {
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const end = Math.min(length, data.length - offset);
  for (let k = 1; k <= 20; k++) {
    const partial = k * hz;
    if (partial > rate * 0.45) break;
    const amplitude = (0.25 * Math.abs(Math.sin(k * Math.PI * 0.18))) / Math.pow(k, 1.1);
    const decay = 1.6 / (1 + 0.35 * k);
    for (let i = 0; i < end; i++) {
      const t = i / rate;
      data[offset + i] += amplitude * Math.min(1, t / 0.002) * Math.exp(-t / decay) * Math.sin(2 * Math.PI * partial * t);
    }
  }
  // The fretting hand lifts before the next note: a quick fade, as a damped string.
  const fade = Math.round(0.02 * rate);
  for (let i = Math.max(0, end - fade); i < end; i++) data[offset + i] *= (end - i) / fade;
}

export function synthSource(context: AudioContext): AudioNode {
  const rate = context.sampleRate;
  const perNote = Math.round(NOTE_SECONDS * rate);
  const buffer = context.createBuffer(1, perNote * SYNTH_SEQUENCE.length, rate);
  const data = buffer.getChannelData(0);
  SYNTH_SEQUENCE.forEach((midi, index) => pluck(data, index * perNote, perNote, midi, rate));

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

/** A note for `scriptedSource`: which, and when, in ms from the source's start. */
export interface ScriptedNote {
  midi: number;
  atMs: number;
}

/**
 * Plays a script once: `?debug&source=exercise` uses it to play the exercise
 * itself, with deliberate mistakes, so a whole lesson can be run and reviewed
 * with no guitar. `started.ms` receives the audio-clock time it began.
 */
export function scriptedSource(notes: ScriptedNote[], started: { ms: number }): (context: AudioContext) => AudioNode {
  return (context) => {
    const rate = context.sampleRate;
    const lastMs = notes.reduce((last, note) => Math.max(last, note.atMs), 0);
    const buffer = context.createBuffer(1, Math.round(((lastMs + 2000) / 1000) * rate), rate);
    const data = buffer.getChannelData(0);
    const sorted = [...notes].sort((a, b) => a.atMs - b.atMs);
    sorted.forEach((note, i) => {
      const offset = Math.round((note.atMs / 1000) * rate);
      const next = sorted[i + 1] ? Math.round((sorted[i + 1].atMs / 1000) * rate) : offset + Math.round(1.5 * rate);
      pluck(data, offset, next - offset, note.midi, rate);
    });
    const source = context.createBufferSource();
    source.buffer = buffer;
    // A little ahead, so the first samples are not scheduled in the past.
    const at = context.currentTime + 0.05;
    source.start(at);
    started.ms = at * 1000;
    return source;
  };
}
