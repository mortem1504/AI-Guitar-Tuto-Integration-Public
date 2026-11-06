/**
 * A single-note exercise while it is being played.
 *
 * Two modes, from the slides:
 *
 *   - **loop**: no clock. The class waits on each note, and a wrong one is
 *     repeated until it is right. For learning where the notes are.
 *   - **playThrough**: the tempo runs and nothing stops. Each note is judged
 *     against its beat, and the review afterwards says what went wrong. For
 *     learning to keep going, which is what playing music is.
 *
 * Every time here is in milliseconds on the audio clock (the AudioContext's
 * `currentTime`), the clock the detector stamps onsets with and the clock the
 * count-in clicks are scheduled on, so "late by 80 ms" means 80 ms.
 *
 * In play-through each step owns a zone of time, from halfway after the step
 * before to halfway before the step after. A note is judged by the zone its
 * *onset* falls in, the moment it arrives, so feedback is never held back
 * waiting for the beat to pass (the brief's 200 ms). A zone with no note is
 * judged when it closes, plus `ARRIVAL_SLACK_MS` for a late message to land.
 *
 * Pure: `npm run lesson-check` plays whole sessions through it.
 */

import type { PracticeMode } from "../app/settings";
import { beatMs, type NoteExercise, type NoteStep } from "./exercises";
import { judgeNote, timingWindowMs, WEAK_PEAK, type Attempt, type NoteVerdict } from "./noteJudge";

export type { PracticeMode } from "../app/settings";

/** Clicks before the first note, and before resuming after a pause. */
export const COUNT_IN_BEATS = 3;

/**
 * How long after a zone closes before it is judged empty. A note's message
 * arrives one pitch window after its onset: p95 107 ms in note-check and in
 * Chrome (BITACORA, Phase 1); 300 ms covers that and the 4096-sample window
 * of the lowest notes with room to spare.
 */
export const ARRIVAL_SLACK_MS = 300;

/**
 * In loop mode, this long with no note and nothing louder than WEAK_PEAK on
 * the input means the class probably cannot hear the guitar at all: say so
 * rather than wait forever.
 */
export const LOOP_IDLE_MS = 5000;

export interface JudgedNote {
  index: number;
  verdict: NoteVerdict;
  /** Audio-clock ms when it was judged. */
  atMs: number;
}

export type SessionPhase = "countIn" | "playing" | "paused" | "finished";

interface Zone {
  /** Due time on the audio clock. */
  due: number;
  start: number;
  end: number;
  /** The loudest input peak seen inside the zone. */
  peak: number;
  /** A pitchless onset heard in the zone, kept in case no note follows. */
  unclear: Attempt | null;
  judged: boolean;
}

export class NoteSession {
  readonly beat: number;
  readonly window: number;
  private readonly results: JudgedNote[] = [];
  private readonly skipped: number[] = [];
  private zones: Zone[] = [];
  private index = 0;
  private paused = false;
  private stopped = false;
  /** Audio-clock ms the current run of notes starts from (after a count-in). */
  private resumeAt: number;
  private loopIdleSince: number;
  private loopPeak = 0;
  readonly startedAt: number;
  private endedAt: number | null = null;

  constructor(
    readonly exercise: NoteExercise,
    private practiceMode: PracticeMode,
    nowMs: number,
  ) {
    this.beat = beatMs(exercise.tempo);
    this.window = timingWindowMs(this.beat);
    this.startedAt = nowMs;
    this.resumeAt = nowMs + COUNT_IN_BEATS * this.beat;
    this.loopIdleSince = this.resumeAt;
    this.layZones(0, this.resumeAt);
  }

  get mode(): PracticeMode {
    return this.practiceMode;
  }

  /**
   * The loop toggle on the live screen: carries on from the current note in
   * the other mode, after a fresh count-in (play-through needs a clock to
   * start from; loop mode needs the idle timer reset). Notes already judged
   * stay in the review.
   */
  setMode(mode: PracticeMode, nowMs: number) {
    if (this.finished || mode === this.practiceMode) return;
    this.practiceMode = mode;
    this.paused = true;
    this.resume(nowMs);
  }

  get steps(): NoteStep[] {
    return this.exercise.steps;
  }

  /** The step being asked for: the first one not yet judged. */
  get current(): number {
    return this.index;
  }

  get target(): NoteStep | null {
    return this.steps[this.index] ?? null;
  }

  get judged(): readonly JudgedNote[] {
    return this.results;
  }

  get skippedSteps(): readonly number[] {
    return this.skipped;
  }

  get finished(): boolean {
    return this.stopped || this.index >= this.steps.length;
  }

  get durationMs(): number {
    return (this.endedAt ?? this.results.at(-1)?.atMs ?? this.startedAt) - this.startedAt;
  }

  phase(nowMs: number): SessionPhase {
    if (this.finished) return "finished";
    if (this.paused) return "paused";
    return nowMs < this.resumeAt - this.beat / 2 ? "countIn" : "playing";
  }

  /** When the count-in clicks fall: the beats before the next note. */
  countInTimes(): number[] {
    return Array.from({ length: COUNT_IN_BEATS }, (_, k) => this.resumeAt - (COUNT_IN_BEATS - k) * this.beat);
  }

  /** Beats left in the count-in at this moment (3, 2, 1), or 0 once playing. */
  countInLeft(nowMs: number): number {
    if (this.paused || nowMs >= this.resumeAt - this.beat / 2) return 0;
    return Math.min(COUNT_IN_BEATS, Math.ceil((this.resumeAt - nowMs) / this.beat - 0.5));
  }

  /** When a step is due, in play-through. */
  dueOf(index: number): number | null {
    return this.mode === "playThrough" ? (this.zones[index]?.due ?? null) : null;
  }

  /** The detector heard something. Returns the verdict to show, if it decided one. */
  hear(attempt: Attempt, nowMs: number): NoteVerdict | null {
    if (this.finished || this.paused || attempt.kind === "none") return null;
    // Anything before the count-in has finished is the count-in, or noise.
    if (attempt.onsetMs < this.resumeAt - this.beat / 2) return null;
    this.loopIdleSince = nowMs;
    this.loopPeak = 0;
    return this.mode === "loop" ? this.hearLoop(attempt, nowMs) : this.hearTimed(attempt, nowMs);
  }

  /**
   * Time passes. `peak` is the loudest input sample since the last tick, and
   * `peakAtMs` when it was measured. Returns verdicts decided by the clock:
   * steps nothing was played for, or a loop that has gone silent.
   */
  tick(nowMs: number, peak: number, peakAtMs: number): NoteVerdict[] {
    if (this.finished || this.paused) return [];
    if (this.mode === "loop") return this.tickLoop(nowMs, peak);

    for (const zone of this.zones) {
      if (!zone.judged && peakAtMs >= zone.start && peakAtMs < zone.end) zone.peak = Math.max(zone.peak, peak);
    }
    const decided: NoteVerdict[] = [];
    while (this.index < this.steps.length) {
      const zone = this.zones[this.index];
      if (zone.judged) {
        this.index++;
        continue;
      }
      if (nowMs < zone.end + ARRIVAL_SLACK_MS) break;
      const attempt: Attempt = zone.unclear ?? { kind: "none", peak: zone.peak };
      decided.push(this.record(this.index, attempt, nowMs));
      this.index++;
    }
    this.markEnd(nowMs);
    return decided;
  }

  pause(nowMs: number) {
    if (this.finished || this.paused) return;
    this.paused = true;
    // In play-through the clock stops with the student: the notes not yet
    // played are given back, to be laid out again after the next count-in.
    for (let i = this.index; i < this.zones.length; i++) {
      this.zones[i].unclear = null;
      this.zones[i].peak = 0;
    }
    this.loopIdleSince = nowMs;
  }

  resume(nowMs: number) {
    if (!this.paused || this.finished) return;
    this.paused = false;
    this.resumeAt = nowMs + COUNT_IN_BEATS * this.beat;
    this.loopIdleSince = this.resumeAt;
    this.loopPeak = 0;
    this.layZones(this.index, this.resumeAt);
  }

  /** Moves past the current note without playing it (loop mode's "skip"). */
  skip(nowMs: number) {
    if (this.finished) return;
    this.skipped.push(this.index);
    if (this.zones[this.index]) this.zones[this.index].judged = true;
    this.index++;
    this.loopIdleSince = nowMs;
    this.markEnd(nowMs);
  }

  /** Ends the session where it stands. */
  stop(nowMs: number) {
    if (this.finished) return;
    this.stopped = true;
    this.endedAt = nowMs;
  }

  private hearLoop(attempt: Attempt, nowMs: number): NoteVerdict | null {
    const verdict = this.record(this.index, attempt, nowMs);
    if (verdict.state === "clean") {
      this.index++;
      this.markEnd(nowMs);
    }
    return verdict;
  }

  private hearTimed(attempt: Attempt, nowMs: number): NoteVerdict | null {
    const index = this.zoneOf(attempt.kind === "none" ? nowMs : attempt.onsetMs);
    if (index < 0) return null;
    const zone = this.zones[index];
    if (zone.judged) return null; // a second pluck in a zone already judged: the first one counts
    if (attempt.kind === "unclear") {
      // Said at once, but the zone stays open: a clear pluck may still follow.
      zone.unclear = attempt;
      return judgeNote(this.steps[index], attempt, { dueMs: zone.due, windowMs: this.window });
    }
    const verdict = this.record(index, attempt, nowMs);
    while (this.index < this.steps.length && this.zones[this.index].judged) this.index++;
    this.markEnd(nowMs);
    return verdict;
  }

  private tickLoop(nowMs: number, peak: number): NoteVerdict[] {
    if (nowMs < this.resumeAt) return [];
    this.loopPeak = Math.max(this.loopPeak, peak);
    if (nowMs - this.loopIdleSince < LOOP_IDLE_MS) return [];
    this.loopIdleSince = nowMs;
    const quiet = this.loopPeak < WEAK_PEAK;
    this.loopPeak = 0;
    const target = this.target;
    // Only silence is worth interrupting for; a student taking their time
    // over a note they can hear themselves playing is just thinking.
    return quiet && target ? [judgeNote(target, { kind: "none", peak: 0 }, { dueMs: null, windowMs: this.window })] : [];
  }

  private record(index: number, attempt: Attempt, nowMs: number): NoteVerdict {
    const zone = this.zones[index];
    const verdict = judgeNote(this.steps[index], attempt, {
      dueMs: this.mode === "playThrough" ? zone.due : null,
      windowMs: this.window,
    });
    if (this.mode === "playThrough") zone.judged = true;
    this.results.push({ index, verdict, atMs: nowMs });
    return verdict;
  }

  private zoneOf(onsetMs: number): number {
    for (let i = this.index; i < this.zones.length; i++) {
      const zone = this.zones[i];
      if (onsetMs >= zone.start && onsetMs < zone.end) return i;
    }
    return -1;
  }

  /** Lays the steps from `from` onwards on the clock, with step `from` due at `at`. */
  private layZones(from: number, at: number) {
    const steps = this.steps;
    const origin = steps[from]?.beat ?? 0;
    const dueOf = (i: number) => at + (steps[i].beat - origin) * this.beat;
    for (let i = from; i < steps.length; i++) {
      const due = dueOf(i);
      const before = i > from ? due - dueOf(i - 1) : this.beat;
      const after = i + 1 < steps.length ? dueOf(i + 1) - due : this.beat;
      // A note already judged (played ahead of a pause) stays judged.
      const judged = this.zones[i]?.judged ?? false;
      this.zones[i] = { due, start: due - before / 2, end: due + after / 2, peak: 0, unclear: null, judged };
    }
  }

  private markEnd(nowMs: number) {
    if (this.index >= this.steps.length && this.endedAt === null) this.endedAt = nowMs;
  }
}

export interface MistakeMark {
  /** Ms from the start of the session. */
  atMs: number;
  index: number;
  verdict: NoteVerdict;
}

export interface SessionSummary {
  /** Notes judged as right or wrong: clean plus mistakes. */
  attempted: number;
  clean: number;
  mistakes: number;
  /** Not counted either way. */
  notCaught: number;
  weakSignal: number;
  skipped: number;
  /** clean / attempted, 0 when nothing was attempted. */
  accuracy: number;
  durationMs: number;
  timeline: MistakeMark[];
  /** The target missed most often, by MIDI note, with how often. */
  mostMissed: { midi: number; count: number } | null;
  /** Steps with a mistake or a skip, for "practise mistakes", in order. */
  missedSteps: number[];
  /** Notes the camera placed on a string and fret, and how many of those were the target's. */
  fusedNotes: number;
  fusedAtTarget: number;
}

export function summarize(session: NoteSession): SessionSummary {
  const judged = session.judged;
  const count = (state: string) => judged.filter((j) => j.verdict.state === state).length;
  const mistakes = judged.filter((j) => j.verdict.counts && j.verdict.state !== "clean");
  const clean = count("clean");
  const attempted = clean + mistakes.length;

  const missesByNote = new Map<number, number>();
  for (const mistake of mistakes) {
    const midi = mistake.verdict.target.midi;
    missesByNote.set(midi, (missesByNote.get(midi) ?? 0) + 1);
  }
  let mostMissed: SessionSummary["mostMissed"] = null;
  for (const [midi, misses] of missesByNote) {
    if (!mostMissed || misses > mostMissed.count) mostMissed = { midi, count: misses };
  }

  const missed = new Set<number>([...mistakes.map((m) => m.index), ...session.skippedSteps]);
  return {
    attempted,
    clean,
    mistakes: mistakes.length,
    notCaught: count("notCaught"),
    weakSignal: count("weakSignal"),
    skipped: session.skippedSteps.length,
    accuracy: attempted > 0 ? clean / attempted : 0,
    durationMs: session.durationMs,
    timeline: mistakes.map((m) => ({ atMs: m.atMs - session.startedAt, index: m.index, verdict: m.verdict })),
    mostMissed,
    missedSteps: [...missed].sort((a, b) => a - b),
    fusedNotes: judged.filter((j) => j.verdict.place !== null).length,
    fusedAtTarget: judged.filter(
      (j) => j.verdict.place !== null && j.verdict.place.string === j.verdict.target.string && j.verdict.place.fret === j.verdict.target.fret,
    ).length,
  };
}
