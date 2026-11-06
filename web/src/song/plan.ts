/**
 * The teaching plan: an ordered list of steps that takes a player from the
 * first note of a song to the whole song at full speed, and the tempo rule
 * that moves them through each step.
 *
 * For every section: meet its new fret positions, then each chunk slow and
 * then at full speed, each new chunk joined to the one before, the hot spots
 * looped on their own as soon as both of their notes have been played
 * together, then the whole section. The whole song at full speed is always
 * the last step.
 *
 * Pure: the lesson screen (Phase 5) runs the steps; this only says what they
 * are and how the tempo answers a run.
 */

import type { Breakdown, HotSpot } from "./breakdown";

/** A tab without a tempo is taught as if it said 100 BPM, so that 60% is a comfortable 60 BPM. */
export const ASSUMED_TEMPO = 100;

/** Every new piece starts at 60% of the song's tempo (the brief's rule). */
export const START_PERCENT = 60;

/**
 * Pieces already played at full speed, joined together, step back to 80%:
 * the seam between them is new even when both halves are not.
 */
const JOIN_PERCENT = 80;

/** The tempo rule: up 10 points after 2 clean runs, down 10 after 3 failed ones, between 40% and 100%. */
export const STEP_PERCENT = 10;
export const CLEAN_TO_RAISE = 2;
export const FAILS_TO_LOWER = 3;
/** Below 40% a phrase falls apart into separate notes; slower than that, go back a step instead. */
export const MIN_PERCENT = 40;
export const MAX_PERCENT = 100;

/** The tempo bounds the note lessons accept (exercises.ts). */
const MIN_BPM = 30;
const MAX_BPM = 240;

export type StepKind = "meet" | "learn" | "upToSpeed" | "join" | "hotSpot" | "section" | "song";

export interface PlanStep {
  index: number;
  kind: StepKind;
  /** English, for the UI and the checks; `kind` and the numbers are there to translate it. */
  title: string;
  fromEvent: number;
  toEvent: number;
  section: number | null;
  chunks: number[];
  /** "meet": the events that first show each new position, in order. */
  events?: number[];
  /** Null for "meet", which waits for each note and has no tempo. */
  startPercent: number | null;
  /** The step is done after CLEAN_TO_RAISE clean runs at this tempo or above. */
  goalPercent: number | null;
  /** Hot spots are looped: two notes played over and over. */
  loop: boolean;
}

export interface Plan {
  steps: PlanStep[];
  /** The song's tempo, or ASSUMED_TEMPO when the tab has none. */
  targetTempo: number;
  tempoKnown: boolean;
}

export function teachingPlan(breakdown: Breakdown): Plan {
  const { song, chunks, hotSpots } = breakdown;
  const steps: PlanStep[] = [];
  const add = (step: Omit<PlanStep, "index">) => steps.push({ index: steps.length, ...step });
  const seen = new Set<string>();
  const drilled = new Set<HotSpot>();
  const drill = (from: number, to: number, section: number) => {
    for (const spot of hotSpots) {
      if (drilled.has(spot) || spot.fromEvent < from || spot.toEvent > to) continue;
      drilled.add(spot);
      add({ kind: "hotSpot", title: `Drill the hard move: notes ${spot.fromEvent + 1}-${spot.toEvent + 1} (${spot.reasons.join(", ")})`, fromEvent: spot.fromEvent, toEvent: spot.toEvent, section, chunks: [], startPercent: START_PERCENT, goalPercent: MAX_PERCENT, loop: true });
    }
  };

  song.sections.forEach((section, s) => {
    const mine = chunks.filter((chunk) => chunk.section === s);
    // New positions: the first time each string and fret appears in the song.
    const firsts: number[] = [];
    for (let i = section.firstEvent; i <= section.lastEvent; i++) {
      let fresh = false;
      for (const note of song.events[i].notes) {
        const key = note.techniques.includes("dead") ? "dead" : `${note.string}:${note.fret}`;
        if (!seen.has(key)) {
          seen.add(key);
          fresh = true;
        }
      }
      if (fresh) firsts.push(i);
    }
    if (firsts.length > 0)
      add({ kind: "meet", title: `${section.name}: meet the notes (${firsts.length} new)`, fromEvent: firsts[0], toEvent: firsts[firsts.length - 1], section: s, chunks: [], events: firsts, startPercent: null, goalPercent: null, loop: false });

    mine.forEach((chunk, k) => {
      const name = `${section.name}, chunk ${k + 1}`;
      const range = { fromEvent: chunk.firstEvent, toEvent: chunk.lastEvent, section: s, chunks: [chunk.index], loop: false };
      add({ kind: "learn", title: `${name}, slowly`, ...range, startPercent: START_PERCENT, goalPercent: START_PERCENT });
      add({ kind: "upToSpeed", title: `${name}, up to speed`, ...range, startPercent: START_PERCENT, goalPercent: MAX_PERCENT });
      drill(chunk.firstEvent, chunk.lastEvent, s);
      if (k > 0) {
        const before = mine[k - 1];
        add({ kind: "join", title: `${section.name}: join chunks ${k} and ${k + 1}`, fromEvent: before.firstEvent, toEvent: chunk.lastEvent, section: s, chunks: [before.index, chunk.index], startPercent: JOIN_PERCENT, goalPercent: MAX_PERCENT, loop: false });
        drill(before.firstEvent, chunk.lastEvent, s);
      }
    });
    // A drilled hot spot goes back into the music it came from before moving on.
    if (mine.length > 1 || steps[steps.length - 1]?.kind === "hotSpot")
      add({ kind: "section", title: `${section.name}, all of it`, fromEvent: section.firstEvent, toEvent: section.lastEvent, section: s, chunks: mine.map((c) => c.index), startPercent: JOIN_PERCENT, goalPercent: MAX_PERCENT, loop: false });
  });

  // Unless the last step already is the whole song at full speed, the plan ends with it.
  const last = steps[steps.length - 1];
  if (last && !(last.fromEvent === 0 && last.toEvent === song.events.length - 1 && last.goalPercent === MAX_PERCENT && !last.loop))
    add({ kind: "song", title: "The whole song", fromEvent: 0, toEvent: song.events.length - 1, section: null, chunks: chunks.map((c) => c.index), startPercent: JOIN_PERCENT, goalPercent: MAX_PERCENT, loop: false });

  return { steps, targetTempo: song.tempo ?? ASSUMED_TEMPO, tempoKnown: song.tempo !== null };
}

// --- The tempo rule -------------------------------------------------------------------

export interface TempoState {
  percent: number;
  /** Clean runs in a row at this tempo. */
  clean: number;
  /** Failed runs in a row at this tempo. */
  failed: number;
}

export interface RunOutcome {
  state: TempoState;
  change: "up" | "down" | "same";
  /** The step's goal is met: move on to the next step. */
  done: boolean;
}

export function startTempo(step: PlanStep): TempoState {
  return { percent: step.startPercent ?? START_PERCENT, clean: 0, failed: 0 };
}

/** What a run does to the tempo: "Clean twice: speeding up to 70%". */
export function afterRun(step: PlanStep, state: TempoState, clean: boolean): RunOutcome {
  const goal = step.goalPercent ?? MAX_PERCENT;
  if (clean) {
    const runs = state.clean + 1;
    if (runs < CLEAN_TO_RAISE) return { state: { ...state, clean: runs, failed: 0 }, change: "same", done: false };
    if (state.percent >= goal) return { state: { ...state, clean: runs, failed: 0 }, change: "same", done: true };
    return { state: { percent: Math.min(MAX_PERCENT, state.percent + STEP_PERCENT), clean: 0, failed: 0 }, change: "up", done: false };
  }
  const fails = state.failed + 1;
  if (fails < FAILS_TO_LOWER || state.percent <= MIN_PERCENT) return { state: { ...state, clean: 0, failed: fails < FAILS_TO_LOWER ? fails : 0 }, change: "same", done: false };
  return { state: { percent: Math.max(MIN_PERCENT, state.percent - STEP_PERCENT), clean: 0, failed: 0 }, change: "down", done: false };
}

/** The metronome for a tempo state, in BPM. */
export function bpmOf(plan: Plan, percent: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round((plan.targetTempo * percent) / 100)));
}
