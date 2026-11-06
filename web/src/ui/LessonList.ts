/**
 * The lesson list.
 *
 * Each row is a lesson, its one-line description, and — once it has been
 * finished — how it went. Locked lessons are shown rather than hidden: seeing
 * that the barre is coming, and that it is four lessons away, is part of what
 * makes the order feel like a plan instead of a wall.
 *
 * Free practice sits at the top, unlocked forever. The locking is a suggestion
 * about what to do next, not a claim that a beginner is forbidden to try a C.
 */

import { LESSONS, subtitleKey, titleKey, type Lesson } from "../lesson/curriculum";
import { isUnlocked, type Progress } from "../lesson/progress";
import type { Translate } from "../i18n";
import { clear, element, requireElement } from "./dom";

export class LessonList {
  private root = requireElement("lessons");
  private card = requireElement("lessons-card");
  private toggle = requireElement<HTMLButtonElement>("lesson-toggle");

  private chooseHandler: ((lesson: Lesson) => void) | null = null;
  private freeHandler: (() => void) | null = null;
  private notesHandler: (() => void) | null = null;

  constructor(
    private progress: () => Progress,
    private t: () => Translate,
  ) {
    this.toggle.addEventListener("click", () => this.setOpen(this.root.classList.contains("gone")));
    this.root.addEventListener("click", (event) => {
      // Clicking the dimmed backdrop closes it; clicking the card does not.
      if (event.target === this.root) this.setOpen(false);
    });
  }

  whenChosen(handler: (lesson: Lesson) => void) {
    this.chooseHandler = handler;
  }

  whenFreeChosen(handler: () => void) {
    this.freeHandler = handler;
  }

  /** The single-note exercises, which live in their own card (no camera). */
  whenNotesChosen(handler: () => void) {
    this.notesHandler = handler;
  }

  get open(): boolean {
    return !this.root.classList.contains("gone");
  }

  setOpen(open: boolean) {
    this.root.classList.toggle("gone", !open);
    this.toggle.setAttribute("aria-pressed", String(open));
    if (open) this.render();
  }

  render() {
    const t = this.t();
    const progress = this.progress();
    clear(this.card);

    this.card.append(element("h2", { text: t("lesson.title") }));

    const list = element("div", { className: "lesson-list" });

    const free = element("button", { className: "lesson", attrs: { type: "button" } });
    free.append(
      element("div", { className: "grow" }, [
        element("div", { className: "title", text: t("lesson.freeplay") }),
        element("div", { className: "sub", text: t("lesson.freeplay.body") }),
      ]),
    );
    free.addEventListener("click", () => {
      this.setOpen(false);
      this.freeHandler?.();
    });
    list.append(free);

    const notes = element("button", { className: "lesson", attrs: { type: "button" } }, [
      element("div", { className: "grow" }, [
        element("div", { className: "title", text: t("notes.lessonRow") }),
        element("div", { className: "sub", text: t("notes.lessonRow.body") }),
      ]),
    ]);
    notes.addEventListener("click", () => {
      this.setOpen(false);
      this.notesHandler?.();
    });
    list.append(notes);

    for (const lesson of LESSONS) {
      const unlocked = isUnlocked(progress, lesson.requires);
      const record = progress[lesson.id];

      const row = element("button", { className: "lesson", attrs: { type: "button" } });
      row.disabled = !unlocked;

      const words = element("div", { className: "grow" }, [
        element("div", { className: "title", text: t(titleKey(lesson)) }),
        element("div", {
          className: "sub",
          text: unlocked ? t(subtitleKey(lesson)) : t("lesson.locked"),
        }),
      ]);
      row.append(words);

      if (record?.done) {
        row.append(element("div", { className: "score", text: t("lesson.streak", { count: record.streak }) }));
      }

      row.addEventListener("click", () => {
        if (!unlocked) return;
        this.setOpen(false);
        this.chooseHandler?.(lesson);
      });
      list.append(row);
    }

    this.card.append(list);
  }
}
