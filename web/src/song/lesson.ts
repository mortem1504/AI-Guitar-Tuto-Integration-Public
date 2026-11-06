/**
 * A plan step as something to play: the note exercise the existing lesson
 * screen runs, the notes the Listen button plays, and what a run does to the
 * song's progress.
 *
 * The note lessons hear one note at a time, so only single, sounding notes
 * become graded steps. Chords and dead notes stay on the timeline (shown and
 * heard by Listen, never graded) and keep their time in play-along, so the
 * rhythm around them is right. Pure: `npm run song-check` exercises it.
 */

import type { JudgedNote } from "../lesson/NoteSession";
import type { NoteExercise, NoteStep } from "../lesson/exercises";
import type { Breakdown } from "./breakdown";
import type { ChunkProgress, SongProgress, SongRecord } from "./library";
import type { TabEvent, TabNote } from "./model";
import { afterRun, bpmOf, CLEAN_TO_RAISE, MAX_PERCENT, startTempo, type Plan, type PlanStep, type TempoState } from "./plan";

/** A hard move is drilled as its two notes four times over: enough to feel the shape, short enough to repeat. */
const HOT_SPOT_REPEATS = 4;

/** A text tab has no rhythm: one beat per event is an even pulse the player can follow. */
const TEXT_BEATS = 1;

/** The techniques that may make no clear pluck: the note can arrive without an onset. */
const LEGATO: ReadonlySet<string> = new Set(["hammer", "pull", "slideUp", "slideDown"]);

/** The events a step plays, in order: a hot spot repeated, the new positions of a "meet", or a range. */
export function stepEvents(step: PlanStep): number[] {
  if (step.kind === "meet" && step.events) return [...step.events];
  const range = Array.from({ length: step.toEvent - step.fromEvent + 1 }, (_, k) => step.fromEvent + k);
  if (!step.loop) return range;
  return Array.from({ length: HOT_SPOT_REPEATS }, () => range).flat();
}

/** The one note a step can grade, or null: chords and dead notes are listen-only. */
export function gradedNote(event: TabEvent): TabNote | null {
  return event.notes.length === 1 && !event.notes[0].techniques.includes("dead") ? event.notes[0] : null;
}

/**
 * When each event of `order` falls, in beats from the first. With rhythm, the
 * gap is the score's own (a jump back, as in a repeated hot spot, waits the
 * note's length); a text tab, and a "meet" step, gets an even pulse.
 */
export function beatsOf(events: readonly TabEvent[], order: readonly number[], even: boolean): number[] {
  const out: number[] = [];
  let at = 0;
  order.forEach((index, k) => {
    out.push(at);
    const event = events[index];
    const next = events[order[k + 1]];
    if (even || event.beat === null || event.durationBeats === null) at += TEXT_BEATS;
    else if (next && next.index === index + 1 && next.beat !== null) at += next.beat - event.beat;
    else at += event.durationBeats;
  });
  return out;
}

export interface StepExercise {
  exercise: NoteExercise;
  /** For each exercise step, the song event it is. */
  eventOf: number[];
  /** Events in the step that are shown and heard but not graded. */
  listenOnly: number;
  /** For each exercise step, a second pitch to accept: a bend's target, in case the pitch is read late. */
  alsoAccept: (number | null)[];
  /** Exercise steps that may come without a clear pluck (hammer-ons, pull-offs, slides). */
  legato: Set<number>;
  /** For each exercise step, its column in `order`. */
  columnOf: number[];
  /** The events the step plays (`stepEvents`), and the beat each falls on, for the timeline and Listen. */
  order: number[];
  beats: number[];
}

export function exerciseFor(recordId: string, breakdown: Breakdown, plan: Plan, step: PlanStep, percent: number): StepExercise {
  const { events } = breakdown.song;
  const order = stepEvents(step);
  const beats = beatsOf(events, order, step.kind === "meet");
  const steps: NoteStep[] = [];
  const eventOf: number[] = [];
  const alsoAccept: (number | null)[] = [];
  const legato = new Set<number>();
  const columnOf: number[] = [];
  let listenOnly = 0;
  order.forEach((index, k) => {
    const note = gradedNote(events[index]);
    if (!note) {
      listenOnly++;
      return;
    }
    if (note.techniques.some((t) => LEGATO.has(t))) legato.add(steps.length);
    alsoAccept.push(note.techniques.includes("bend") && note.bendSemitones ? note.midi + Math.round(note.bendSemitones) : null);
    eventOf.push(index);
    columnOf.push(k);
    steps.push({ string: note.string, fret: note.fret, midi: note.midi, beat: beats[k] });
  });
  // Graded steps start on beat 0, so the count-in leads straight into the first of them.
  const first = steps[0]?.beat ?? 0;
  for (const s of steps) s.beat -= first;
  return {
    exercise: { id: `song:${recordId}:${step.index}`, tempo: bpmOf(plan, percent), steps },
    eventOf,
    listenOnly,
    alsoAccept,
    legato,
    columnOf,
    order,
    beats,
  };
}

/** One moment for the Listen synth: seconds from the start, how long it rings, and what sounds. */
export interface ListenMoment {
  at: number;
  seconds: number;
  notes: TabNote[];
}

/** A note rings for its written length, or one beat in a text tab, and never past this: long notes are not the point of listening. */
const LISTEN_MAX_SECONDS = 2.5;

/** What Listen plays for a step at a tempo: every event, chords and dead notes too, on the step's beats. */
export function listenMoments(events: readonly TabEvent[], made: Pick<StepExercise, "order" | "beats">, bpm: number): ListenMoment[] {
  const beat = 60 / bpm;
  const first = made.beats[0] ?? 0;
  return made.order.map((index, k) => {
    const event = events[index];
    const length = event.durationBeats ?? (made.beats[k + 1] !== undefined ? made.beats[k + 1] - made.beats[k] : TEXT_BEATS);
    return { at: (made.beats[k] - first) * beat, seconds: Math.min(LISTEN_MAX_SECONDS, Math.max(0.08, length * beat)), notes: event.notes };
  });
}

/**
 * A run is clean when nothing counted against it and nothing was skipped. A
 * legato note the detector did not catch is let off: a hammer-on can be too
 * quiet to make an onset, and that is the detector's limit, not a mistake.
 */
export function wasClean(made: StepExercise, judged: readonly JudgedNote[], skipped: readonly number[]): boolean {
  if (skipped.length > 0) return false;
  if (judged.some((j) => j.verdict.counts && j.verdict.state !== "clean")) return false;
  const cleanSteps = new Set(judged.filter((j) => j.verdict.state === "clean").map((j) => j.index));
  return made.exercise.steps.every((_, i) => cleanSteps.has(i) || made.legato.has(i));
}

// --- Progress ------------------------------------------------------------------------

export type RunResult =
  /** Clean, and the tempo goes up. */
  | { kind: "faster"; percent: number }
  /** Struggling, and the tempo comes down. */
  | { kind: "slower"; percent: number }
  /** Clean once; one more at this tempo. */
  | { kind: "again"; clean: number; need: number }
  /** Not clean; the same again. */
  | { kind: "retry" }
  /** In wait-for-me there is no tempo: clean, but to speed up it has to be played along. */
  | { kind: "playAlong" }
  /** The step is done. */
  | { kind: "next" }
  /** The last step is done: the whole song, clean at full speed. */
  | { kind: "song" };

export type Mastery = "new" | "learning" | "clean" | "mastered";

export function chunkMastery(progress: ChunkProgress | undefined): Mastery {
  if (!progress || progress.runs === 0) return "new";
  if (progress.bestPercent >= MAX_PERCENT) return "mastered";
  return progress.cleanRuns > 0 ? "clean" : "learning";
}

/** A section is as far along as its least practised chunk. */
export function sectionMastery(breakdown: Breakdown, progress: SongProgress, section: number): Mastery {
  const rank: Mastery[] = ["new", "learning", "clean", "mastered"];
  const states = breakdown.chunks.filter((c) => c.section === section).map((c) => chunkMastery(progress.chunks[c.index]));
  if (states.length === 0) return "new";
  // "learning" when any chunk has been started, even if others are new: the section has begun.
  const worst = states.reduce((a, b) => (rank.indexOf(a) <= rank.indexOf(b) ? a : b));
  return worst === "new" && states.some((s) => s !== "new") ? "learning" : worst;
}

/** The tempo a step continues at: where it was left, or its own start. */
export function tempoFor(progress: SongProgress, step: PlanStep): TempoState {
  return progress.step === step.index && progress.tempo ? progress.tempo : startTempo(step);
}

/** The first step of a section, for "practise this section". */
export function firstStepOf(plan: Plan, section: number): number {
  return Math.max(0, plan.steps.findIndex((s) => s.section === section));
}

/**
 * What one run does to the record: the chunks' history, the tempo, and the
 * step to continue from. `timed` is play-along; wait-for-me runs teach the
 * notes but never move the tempo. A "meet" step is done when it is played
 * through without skipping: it is about finding the notes, not about speed.
 */
export function recordRun(record: SongRecord, plan: Plan, step: PlanStep, timed: boolean, clean: boolean, finished: boolean): { record: SongRecord; result: RunResult } {
  const state = tempoFor(record.progress, step);
  const chunks = [...record.progress.chunks];
  for (const c of step.chunks) {
    const before = chunks[c] ?? { runs: 0, cleanRuns: 0, bestPercent: 0 };
    const percent = timed ? state.percent : 0;
    chunks[c] = { runs: before.runs + 1, cleanRuns: before.cleanRuns + (clean ? 1 : 0), bestPercent: clean ? Math.max(before.bestPercent, percent) : before.bestPercent };
  }
  for (let i = 0; i < chunks.length; i++) chunks[i] ??= { runs: 0, cleanRuns: 0, bestPercent: 0 };

  let result: RunResult;
  let tempo: TempoState | null = state;
  let next = step.index;
  if (step.kind === "meet" || step.startPercent === null) {
    result = finished ? { kind: "next" } : { kind: "retry" };
  } else if (!timed) {
    // Wait-for-me: clean runs still finish a "slowly" step, whose goal is the starting tempo.
    const runs = clean ? state.clean + 1 : 0;
    tempo = { ...state, clean: runs, failed: 0 };
    if (!clean) result = { kind: "retry" };
    else if (step.goalPercent !== null && step.goalPercent <= state.percent) result = runs >= CLEAN_TO_RAISE ? { kind: "next" } : { kind: "again", clean: runs, need: CLEAN_TO_RAISE };
    else result = { kind: "playAlong" };
  } else {
    const outcome = afterRun(step, state, clean);
    tempo = outcome.state;
    if (outcome.done) result = { kind: "next" };
    else if (outcome.change === "up") result = { kind: "faster", percent: outcome.state.percent };
    else if (outcome.change === "down") result = { kind: "slower", percent: outcome.state.percent };
    else result = clean ? { kind: "again", clean: outcome.state.clean, need: CLEAN_TO_RAISE } : { kind: "retry" };
  }
  if (result.kind === "next") {
    next = step.index + 1;
    tempo = null;
    if (next >= plan.steps.length) {
      result = { kind: "song" };
      next = plan.steps.length - 1; // stay on the whole song: it can always be played again
    }
  }
  return { record: { ...record, progress: { step: next, tempo, chunks } }, result };
}

/** The name the player sees for a section: theirs if they gave one. */
export function sectionName(record: SongRecord, breakdown: Breakdown, section: number): string {
  return record.sectionNames[section] || breakdown.song.sections[section]?.name || "";
}
