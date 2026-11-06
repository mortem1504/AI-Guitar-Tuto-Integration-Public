/**
 * The song screens around a lesson: the library, one song's overview
 * (sections as cards with difficulty, chunks and mastery; continue where I
 * left off), and the result after a run with what to do next. Plus the
 * sentences they share, translated from the breakdown's numbers rather than
 * its English.
 */

import type { Translate, TranslationKey } from "../i18n";
import { breakDown, type Breakdown, type Difficulty, type HotSpotReason } from "../song/breakdown";
import { chunkMastery, sectionMastery, sectionName, type Mastery, type RunResult } from "../song/lesson";
import type { SongRecord } from "../song/library";
import type { Plan, PlanStep } from "../song/plan";
import { element } from "./dom";
import { tuningText } from "./songImport";

// --- Sentences --------------------------------------------------------------------------

export function stepTitle(t: Translate, record: SongRecord, breakdown: Breakdown, step: PlanStep): string {
  const section = step.section === null ? "" : sectionName(record, breakdown, step.section);
  const chunkNumber = (chunk: number) => breakdown.chunks.filter((c) => c.section === breakdown.chunks[chunk]?.section && c.index <= chunk).length;
  switch (step.kind) {
    case "meet":
      return t("step.meet", { section, count: step.events?.length ?? 0 });
    case "learn":
    case "upToSpeed":
      return t(`step.${step.kind}`, { section, chunk: chunkNumber(step.chunks[0]) });
    case "join":
      return t("step.join", { section, a: chunkNumber(step.chunks[0]), b: chunkNumber(step.chunks[1]) });
    case "hotSpot":
      return t("step.hotSpot", { from: step.fromEvent + 1, to: step.toEvent + 1 });
    case "section":
      return t("step.section", { section });
    case "song":
      return t("step.song");
  }
}

/** "medium: 3 hand shifts". Difficulty bands split the 0-100 score in thirds. */
export function difficultyText(t: Translate, difficulty: Difficulty): string {
  const band = t(difficulty.score < 34 ? "difficulty.easy" : difficulty.score < 67 ? "difficulty.medium" : "difficulty.hard");
  const top = difficulty.factors.find((f) => f.score > 0);
  return top ? `${band}: ${t(`factor.${top.key}` as TranslationKey, { value: top.value })}` : band;
}

export function whyText(t: Translate, why: HotSpotReason): string {
  switch (why.kind) {
    case "jump":
      return t("why.jump", { frets: why.frets });
    case "skip":
      return t("why.skip", { strings: why.strings });
    case "shift":
      return t("why.shift", { fret: why.fret });
    case "technique":
      return t("why.technique", { techniques: why.techniques.map((k) => t(`tech.${k}` as TranslationKey)).join(", ") });
    case "chord":
      return t("why.chord");
    case "fast":
      return t("why.fast", { seconds: why.seconds.toFixed(2) });
  }
}

export function resultText(t: Translate, result: RunResult, next: string): string {
  switch (result.kind) {
    case "faster":
    case "slower":
      return t(`result.${result.kind}`, { percent: result.percent });
    case "again":
      return t("result.again", { clean: result.clean, need: result.need });
    case "next":
      return t("result.next", { step: next });
    default:
      return t(`result.${result.kind}`);
  }
}

function masteryTag(t: Translate, mastery: Mastery): HTMLElement {
  return element("span", { className: `tag mastery-${mastery}`, text: t(`mastery.${mastery}`) });
}

/** Share of chunks mastered, for the library and the dashboard. */
export function masteredPercent(record: SongRecord, chunks: number): number {
  if (chunks === 0) return 0;
  const done = Array.from({ length: chunks }, (_, i) => chunkMastery(record.progress.chunks[i])).filter((m) => m === "mastered").length;
  return Math.round((100 * done) / chunks);
}

/** A line per song for the dashboard: newest opened first, as the library keeps them. */
export interface SongSummary {
  id: string;
  title: string;
  percent: number;
}

export function songSummaries(records: readonly SongRecord[]): SongSummary[] {
  return records.map((record) => ({ id: record.id, title: record.song.title, percent: masteredPercent(record, breakDown(record.song).chunks.length) }));
}

const button = (text: string, className: string, onClick: () => void) => {
  const node = element("button", { className, text, attrs: { type: "button" } });
  node.addEventListener("click", onClick);
  return node;
};

// --- The library -----------------------------------------------------------------------

export interface LibraryContext {
  t: Translate;
  songs: readonly { record: SongRecord; chunks: number; sections: number }[];
  open(record: SongRecord): void;
  importTab(): void;
  back(): void;
}

export function libraryView(ctx: LibraryContext): HTMLElement[] {
  const { t } = ctx;
  const nodes: HTMLElement[] = [element("h2", { text: t("songs.title") }), element("p", { className: "quiet", text: t("songs.private") })];
  if (ctx.songs.length === 0) nodes.push(element("p", { text: t("songs.none") }));
  const list = element("div", { className: "lesson-list" });
  for (const { record, chunks, sections } of ctx.songs) {
    const row = element("button", { className: "lesson", attrs: { type: "button" } }, [
      element("div", { className: "grow" }, [
        element("div", { className: "title", text: record.song.title }),
        element("div", { className: "sub", text: t("songs.meta", { notes: record.song.events.length, sections }) }),
      ]),
      element("div", { className: "score", text: t("songs.progress", { percent: masteredPercent(record, chunks) }) }),
    ]);
    row.addEventListener("click", () => ctx.open(record));
    list.append(row);
  }
  nodes.push(list, element("div", { className: "row" }, [button(t("songs.import"), "primary", ctx.importTab), button(t("songs.back"), "ghost", ctx.back)]));
  return nodes;
}

// --- One song --------------------------------------------------------------------------

export interface OverviewContext {
  t: Translate;
  record: SongRecord;
  breakdown: Breakdown;
  plan: Plan;
  listening: boolean;
  confirmDelete: boolean;
  error: string;
  start(step: number): void;
  section(section: number): void;
  listen(): void;
  exportFile(): void;
  remove(): void;
  back(): void;
}

export function overviewView(ctx: OverviewContext): HTMLElement[] {
  const { t, record, breakdown, plan } = ctx;
  const song = record.song;
  const meta = t("overview.meta", {
    tuning: tuningText(song.tuning),
    capo: song.capo ? t("overview.capo", { capo: song.capo }) : t("overview.noCapo"),
    tempo: plan.targetTempo,
  });
  const nodes: HTMLElement[] = [element("h2", { text: song.title }), element("p", { className: "quiet", text: meta })];

  const progress = record.progress;
  const started = progress.step > 0 || progress.chunks.some((c) => c.runs > 0);
  const step = plan.steps[Math.min(progress.step, plan.steps.length - 1)];
  const learned = breakdown.chunks.length > 0 && breakdown.chunks.every((c) => chunkMastery(progress.chunks[c.index]) === "mastered") && step?.kind === "song";
  if (learned) nodes.push(element("p", { className: "start-ok", text: t("overview.done") }));
  if (step) {
    nodes.push(
      element("div", { className: "row" }, [button(t(started ? "overview.continue" : "overview.start"), "primary", () => ctx.start(step.index)), button(t(ctx.listening ? "overview.stopListening" : "overview.listen"), "ghost", ctx.listen)]),
      element("p", { className: "quiet", text: `${t("overview.next", { step: stepTitle(t, record, breakdown, step) })} · ${t("step.count", { n: step.index + 1, total: plan.steps.length })}` }),
    );
  }

  nodes.push(element("h3", { text: t("overview.sections") }));
  const cards = element("div", { className: "song-sections" });
  breakdown.song.sections.forEach((_, s) => {
    const chunks = breakdown.chunks.filter((c) => c.section === s);
    // A section is as hard as its hardest chunk.
    const hardest = chunks.reduce((a, b) => (b.difficulty.score > a.difficulty.score ? b : a), chunks[0]);
    const spots = breakdown.hotSpots.filter((h) => h.section === s);
    const card = element("div", { className: "song-section" }, [
      element("div", { className: "song-section-head" }, [element("strong", { text: sectionName(record, breakdown, s) }), masteryTag(t, sectionMastery(breakdown, progress, s))]),
      element("div", { className: "sub", text: t("overview.section.meta", { chunks: chunks.length, difficulty: hardest ? difficultyText(t, hardest.difficulty) : "" }) }),
    ]);
    if (spots.length) card.append(element("div", { className: "sub", text: t("overview.hotSpots", { list: spots.map((h) => h.why.map((w) => whyText(t, w)).join(", ")).join("; ") }) }));
    card.append(button(t("overview.practise"), "ghost", () => ctx.section(s)));
    cards.append(card);
  });
  nodes.push(cards, element("p", { className: "quiet", text: t("overview.fingering") }));
  if (ctx.error) nodes.push(element("p", { className: "start-warn", text: ctx.error, attrs: { role: "alert" } }));
  nodes.push(
    element("div", { className: "row" }, [
      button(t("overview.export"), "ghost", ctx.exportFile),
      button(t(ctx.confirmDelete ? "overview.deleteConfirm" : "overview.delete"), ctx.confirmDelete ? "danger" : "ghost", ctx.remove),
      button(t("songs.back"), "ghost", ctx.back),
    ]),
  );
  return nodes;
}

// --- After a run -----------------------------------------------------------------------

export interface ResultContext {
  t: Translate;
  title: string;
  text: string;
  score: string;
  next(): void;
  again(): void;
  back(): void;
}

export function resultView(ctx: ResultContext): HTMLElement[] {
  const { t } = ctx;
  return [
    element("h2", { text: ctx.title }),
    element("p", { className: "song-result", text: ctx.text, attrs: { "aria-live": "polite" } }),
    ...(ctx.score ? [element("p", { className: "quiet", text: ctx.score })] : []),
    element("div", { className: "row" }, [button(t("result.continue"), "primary", ctx.next), button(t("result.again.button"), "ghost", ctx.again), button(t("result.back"), "ghost", ctx.back)]),
  ];
}
