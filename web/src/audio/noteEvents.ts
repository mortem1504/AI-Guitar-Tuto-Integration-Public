/**
 * The worklet's raw messages, cleaned into something a lesson can judge.
 *
 * The detector reports every onset it hears. Most are notes. A few are not
 * what a student would call a note: a string re-excited by its own sustain, or
 * the tail of a note already reported whose pitch could not be read again.
 * This is where those are dropped, so that every event that reaches a judge
 * is one the student would agree they played.
 *
 * "Didn't catch that" is a real answer here, not an error: an onset loud
 * enough to be a pluck with no pitch anyone would trust. A lesson must not
 * count it as a wrong note (Phase 3's feedback state 5).
 *
 * Pure: messages in, events out. `npm run note-check` drives it directly.
 */

import type { DetectorMessage } from "./dsp/detector";

export interface NoteEvent {
  kind: "note";
  midi: number;
  hz: number;
  cents: number;
  confidence: number;
  /** AudioContext time of the pluck, in seconds. */
  onsetTime: number;
  /** AudioContext time the pitch was settled. */
  detectTime: number;
  rms: number;
}

export interface UnclearEvent {
  kind: "unclear";
  onsetTime: number;
  detectTime: number;
  rms: number;
}

export interface LevelEvent {
  kind: "level";
  time: number;
  rms: number;
  peak: number;
  noiseFloor: number;
}

export type ListenEvent = NoteEvent | UnclearEvent | LevelEvent;

export interface NoteEventOptions {
  /**
   * The same note again sooner than this is the first one re-triggering, not
   * a second pluck. Must stay below the gap between fast repeated notes:
   * sixteenths at 120 bpm are 125 ms apart.
   */
  retriggerMs: number;
  /** A pitchless onset this soon after a note is that note's tail. */
  unclearAfterNoteMs: number;
}

export const NOTE_EVENT_OPTIONS: NoteEventOptions = {
  // The detector's own refractory period is 60 ms; this catches the rarer
  // re-trigger just past it, while staying under 125 ms.
  retriggerMs: 90,
  unclearAfterNoteMs: 120,
};

export class NoteEvents {
  private lastNote: NoteEvent | null = null;

  constructor(private readonly options: NoteEventOptions = NOTE_EVENT_OPTIONS) {}

  /** One message in, at most one event out. */
  accept(message: DetectorMessage): ListenEvent | null {
    switch (message.type) {
      case "level":
        return { kind: "level", time: message.time, rms: message.rms, peak: message.peak, noiseFloor: message.noiseFloor };

      case "note": {
        const last = this.lastNote;
        const sinceLastMs = last ? (message.onsetTime - last.onsetTime) * 1000 : Number.POSITIVE_INFINITY;
        if (last && last.midi === message.midi && sinceLastMs < this.options.retriggerMs) return null;
        const event: NoteEvent = {
          kind: "note",
          midi: message.midi,
          hz: message.hz,
          cents: message.cents,
          confidence: message.confidence,
          onsetTime: message.onsetTime,
          detectTime: message.detectTime,
          rms: message.rms,
        };
        this.lastNote = event;
        return event;
      }

      case "unpitched": {
        const last = this.lastNote;
        if (last && (message.onsetTime - last.onsetTime) * 1000 < this.options.unclearAfterNoteMs) return null;
        return { kind: "unclear", onsetTime: message.onsetTime, detectTime: message.detectTime, rms: message.rms };
      }
    }
  }

  reset() {
    this.lastNote = null;
  }
}
