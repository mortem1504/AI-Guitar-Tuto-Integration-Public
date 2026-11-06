/**
 * The session review: accuracy, notes attempted, clean, mistakes, time, the
 * mistake timeline, the most-missed note, and "practise mistakes".
 */

import type { Translate } from "../i18n";
import { mistakesExercise, type NoteExercise } from "../lesson/exercises";
import type { SessionSummary } from "../lesson/NoteSession";
import type { SessionRecord } from "../lesson/sessionStore";
import { element } from "./dom";
import { feedbackText, positionText } from "./feedback";

export interface ReviewContext {
  t: Translate;
  summary: SessionSummary;
  exercise: NoteExercise;
  title: string;
  latency: SessionRecord["latency"];
  nameOf(midi: number): string;
  practise(mistakes: NoteExercise): void;
  again(): void;
  back(): void;
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export function reviewView(ctx: ReviewContext): HTMLElement[] {
  const { t, summary, exercise } = ctx;
  const nodes: HTMLElement[] = [element("h2", { text: t("notes.review.title", { title: ctx.title }) })];

  const stats: [string, string][] = [
    [t("notes.review.accuracy"), summary.attempted > 0 ? `${Math.round(summary.accuracy * 100)}%` : "—"],
    [t("notes.review.attempted"), String(summary.attempted)],
    [t("notes.review.clean"), String(summary.clean)],
    [t("notes.review.mistakes"), String(summary.mistakes)],
    [t("notes.review.time"), clock(summary.durationMs)],
  ];
  nodes.push(
    element(
      "div",
      { className: "stats" },
      stats.map(([label, value]) => element("div", { className: "stat" }, [element("b", { text: value }), element("span", { text: label })])),
    ),
  );

  const notCounted = summary.notCaught + summary.weakSignal;
  if (notCounted > 0 || summary.skipped > 0) {
    nodes.push(element("p", { className: "quiet", text: t("notes.review.notCounted", { count: notCounted, skipped: summary.skipped }) }));
  }
  const missed = summary.mostMissed;
  if (missed) {
    const target = exercise.steps.find((s) => s.midi === missed.midi);
    nodes.push(
      element("p", {
        text: t("notes.review.mostMissed", {
          note: ctx.nameOf(missed.midi),
          position: target ? positionText(t, target) : "",
          count: missed.count,
        }),
      }),
    );
  }

  if (summary.timeline.length > 0) {
    const list = element("ol", { className: "timeline" });
    for (const mark of summary.timeline.slice(0, 40)) {
      const text = feedbackText(t, mark.verdict, ctx.nameOf);
      list.append(
        element("li", { className: `state-${mark.verdict.state}` }, [
          element("span", { className: "at", text: clock(mark.atMs) }),
          element("span", { className: "icon", text: text.icon, attrs: { "aria-hidden": "true" } }),
          element("span", { text: `${text.word}: ${text.line}` }),
        ]),
      );
    }
    nodes.push(element("h3", { text: t("notes.review.timeline") }), list);
  } else if (summary.attempted > 0) {
    nodes.push(element("p", { className: "start-lead", text: t("notes.review.noMistakes") }));
  }

  if (summary.fusedNotes > 0) {
    nodes.push(element("p", { className: "quiet", text: t("notes.review.fused", { fused: summary.fusedNotes, atTarget: summary.fusedAtTarget }) }));
  }
  const latency = ctx.latency;
  if (latency) {
    nodes.push(
      element("p", {
        className: "quiet",
        text: t("notes.review.latency", { p50: Math.round(latency.p50), p95: Math.round(latency.p95), count: latency.count }),
      }),
    );
  }

  const buttons: HTMLElement[] = [];
  const again = mistakesExercise(exercise, summary.missedSteps);
  if (again) {
    const practise = element("button", { className: "primary", text: t("notes.review.practise"), attrs: { type: "button" } });
    practise.addEventListener("click", () => ctx.practise(again));
    buttons.push(practise);
  }
  const replay = element("button", { className: again ? "ghost" : "primary", text: t("notes.review.again"), attrs: { type: "button" } });
  replay.addEventListener("click", () => ctx.again());
  const back = element("button", { className: "ghost", text: t("notes.review.back"), attrs: { type: "button" } });
  back.addEventListener("click", () => ctx.back());
  buttons.push(replay, back);
  nodes.push(element("div", { className: "row" }, buttons));
  return nodes;
}
