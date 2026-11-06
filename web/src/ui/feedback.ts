/**
 * What each feedback state says.
 *
 * Every state has an icon, a word and a coaching line, so that none of them
 * is carried by colour alone (the slides' rule, and the right one for the one
 * student in twelve who cannot tell the green from the red). The line is the
 * part that teaches: not "wrong", but what was played, what was wanted, and
 * which way to move.
 */

import type { Translate, TranslationKey } from "../i18n";
import type { FeedbackState, NoteVerdict } from "../lesson/noteJudge";
import { fretMove, octavesAway } from "../lesson/noteJudge";
import type { NoteStep } from "../lesson/exercises";

export const FEEDBACK_ICON: Record<FeedbackState, string> = {
  clean: "✓",
  wrongNote: "✗",
  wrongSpot: "⇄",
  timing: "◷",
  notCaught: "?",
  weakSignal: "▁",
};

export interface FeedbackText {
  icon: string;
  word: string;
  line: string;
}

/** "string 2 (B), fret 3" or "string 1 (thin E), open". */
export function positionText(t: Translate, step: Pick<NoteStep, "string" | "fret">): string {
  return t("notes.position", {
    string: step.string,
    name: t(`string.${step.string}` as TranslationKey),
    fret: step.fret === 0 ? t("notes.open") : t("notes.fret", { fret: step.fret }),
  });
}

export function feedbackText(t: Translate, verdict: NoteVerdict, name: (midi: number) => string): FeedbackText {
  const target = verdict.target;
  const icon = FEEDBACK_ICON[verdict.state];
  const wanted = name(target.midi);
  switch (verdict.state) {
    case "clean":
      return { icon, word: t("notes.state.clean"), line: t("notes.line.clean", { note: wanted }) };
    case "wrongNote": {
      const played = verdict.played ?? target.midi;
      const intro = t("notes.line.wrong", { played: name(played), target: wanted });
      return { icon, word: t("notes.state.wrongNote"), line: `${intro} ${wrongNoteAdvice(t, played, target)}` };
    }
    case "wrongSpot":
      return {
        icon,
        word: t("notes.state.wrongSpot"),
        line: t("notes.line.wrongSpot", { note: wanted, position: positionText(t, target) }),
      };
    case "timing": {
      const offset = Math.round(verdict.offsetMs ?? 0);
      const early = offset < 0;
      return {
        icon,
        word: t(early ? "notes.state.early" : "notes.state.late"),
        line: t(early ? "notes.line.early" : "notes.line.late", { note: wanted, ms: Math.abs(offset) }),
      };
    }
    case "notCaught":
      return { icon, word: t("notes.state.notCaught"), line: t("notes.line.notCaught") };
    case "weakSignal":
      return { icon, word: t("notes.state.weakSignal"), line: t("notes.line.weakSignal") };
  }
}

function wrongNoteAdvice(t: Translate, played: number, target: NoteStep): string {
  const octaves = octavesAway(played, target.midi);
  if (octaves !== 0) {
    return t(octaves > 0 ? "notes.move.octaveDown" : "notes.move.octaveUp", { position: positionText(t, target) });
  }
  const move = fretMove(played, target);
  if (move === null) return t("notes.move.goTo", { position: positionText(t, target) });
  const frets = Math.abs(move);
  if (move < 0) return t(frets === 1 ? "notes.move.back1" : "notes.move.back", { frets });
  return t(frets === 1 ? "notes.move.up1" : "notes.move.up", { frets });
}
