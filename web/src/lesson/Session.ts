/**
 * A lesson while it is being played.
 *
 * The one rule that makes this a class rather than a checklist: **a chord has
 * to be held.** Passing the moment the fingers happen to line up would reward
 * a hand sweeping past the right shape on its way somewhere else, and it is
 * exactly the wrong thing to train. Staying is the skill.
 *
 * Everything else follows from that:
 *
 *   - Time only accumulates while every finger is right. One wrong finger and
 *     the bar drains — quickly, but not instantly, so a single dropped frame
 *     from the tracker does not undo two seconds of holding.
 *   - A chord counts as a first-try success only if nothing was ever wrong
 *     while a hand was actually on the neck. Fumbling in the air is not a
 *     mistake; putting a finger in the wrong place is.
 *   - After a pass the class waits a beat before moving on, so the student
 *     sees that it was right rather than just seeing the next chord appear.
 */

import type { ChordJudgement } from "../guitar/judge";
import type { Lesson } from "./curriculum";
import { sequenceOf } from "./curriculum";

export type SessionPhase = "playing" | "passed" | "finished";

/** How long the green stays up before the next chord arrives. */
const CELEBRATE_MS = 700;

/** How fast the hold bar drains when a finger goes wrong, relative to filling. */
const DRAIN_RATE = 2.5;

export interface SessionState {
  phase: SessionPhase;
  /** The chord id being asked for right now. */
  chordId: string;
  index: number;
  total: number;
  /** 0 to 1 — how much of the hold has been earned. */
  hold: number;
  streak: number;
  bestStreak: number;
  firstTryCount: number;
}

export class Session {
  private sequence: string[];
  private index = 0;
  private held = 0;
  private phase: SessionPhase = "playing";
  private passedAt = 0;
  private mistakeOnThisChord = false;
  private streak = 0;
  private bestStreak = 0;
  private firstTryCount = 0;
  private lastTick = 0;

  constructor(readonly lesson: Lesson) {
    this.sequence = sequenceOf(lesson);
  }

  get state(): SessionState {
    return {
      phase: this.phase,
      chordId: this.sequence[Math.min(this.index, this.sequence.length - 1)],
      index: this.index,
      total: this.sequence.length,
      hold: Math.min(1, this.held),
      streak: this.streak,
      bestStreak: this.bestStreak,
      firstTryCount: this.firstTryCount,
    };
  }

  get finished(): boolean {
    return this.phase === "finished";
  }

  /**
   * One frame of the lesson.
   *
   * `judgement` is null when there is nothing to judge — no hand, no neck —
   * which is not a mistake, just an absence, and is treated as one.
   */
  update(judgement: ChordJudgement | null, nowMs: number, holdSeconds: number): SessionState {
    const elapsed = this.lastTick === 0 ? 0 : Math.min(0.25, (nowMs - this.lastTick) / 1000);
    this.lastTick = nowMs;

    if (this.phase === "finished") return this.state;

    if (this.phase === "passed") {
      if (nowMs - this.passedAt >= CELEBRATE_MS) this.advance();
      return this.state;
    }

    const need = Math.max(0.2, holdSeconds);

    if (judgement?.complete) {
      this.held += elapsed / need;
      if (this.held >= 1) this.pass(nowMs);
      return this.state;
    }

    // A hand on the neck with a finger in the wrong place is a mistake; a hand
    // that is simply not there yet is not. That distinction is what keeps the
    // first-try count meaningful.
    const touching = judgement?.perFinger.some((entry) => entry.verdict !== "missing") ?? false;
    if (touching) this.mistakeOnThisChord = true;

    this.held = Math.max(0, this.held - (elapsed / need) * DRAIN_RATE);
    return this.state;
  }

  private pass(nowMs: number) {
    this.phase = "passed";
    this.passedAt = nowMs;
    this.held = 1;
    if (this.mistakeOnThisChord) {
      this.streak = 0;
    } else {
      this.firstTryCount++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    }
  }

  private advance() {
    this.index++;
    this.held = 0;
    this.mistakeOnThisChord = false;
    this.phase = this.index >= this.sequence.length ? "finished" : "playing";
  }

  /** Moves on without credit — for a chord the student cannot get today. */
  skip() {
    if (this.phase === "finished") return;
    this.mistakeOnThisChord = true;
    this.streak = 0;
    this.advance();
  }
}
