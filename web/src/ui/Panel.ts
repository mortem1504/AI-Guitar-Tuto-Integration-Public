/**
 * The settings panel.
 *
 * Four groups, because there are only four kinds of question here: what
 * instrument, which hand, how hard should the marking be, and what do you want
 * to see. Nothing in it is about sound, and there is nothing to make sound
 * with — that is the guitar in your hands.
 *
 * Every control writes straight into the settings object it was handed and
 * then names the key that changed, so App can react to exactly that one thing
 * instead of re-applying everything on every keystroke.
 */

import type { Translate, TranslationKey } from "../i18n";
import { LANGUAGES, LOCALES } from "../i18n";
import { RANGES, type RangeKey, type Settings, type SettingKey } from "../app/settings";
import { clear, element, requireElement } from "./dom";

export class Panel {
  private root = requireElement("panel");
  private toggle = requireElement<HTMLButtonElement>("panel-toggle");
  private open = false;

  constructor(
    private settings: Settings,
    private onChanged: (key: SettingKey) => void,
    private onRecalibrate: () => void,
  ) {
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
  }

  setOpen(open: boolean) {
    this.open = open;
    this.root.classList.toggle("gone", !open);
    this.toggle.setAttribute("aria-pressed", String(open));
  }

  render(t: Translate) {
    clear(this.root);

    this.root.append(
      this.choiceSection(t, "panel.guitar", "guitar", [
        { value: "acoustic", label: t("guitar.acoustic") },
        { value: "electric", label: t("guitar.electric") },
      ]),
      this.choiceSection(t, "panel.hands", "handedness", [
        { value: "right", label: t("hand.right") },
        { value: "left", label: t("hand.left") },
      ]),
    );

    // Re-marking the neck lives with the guitar, because that is when it is
    // needed: a different instrument means a different neck.
    const recalibrate = element("button", {
      className: "ghost",
      text: t("calibrate.recalibrate"),
      attrs: { type: "button" },
    });
    recalibrate.addEventListener("click", () => this.onRecalibrate());
    this.root.append(element("div", { className: "section" }, [recalibrate]));

    this.root.append(
      element("div", { className: "section" }, [
        element("h3", { text: t("panel.practice") }),
        this.slider(t, "panel.tolerance", "tolerance", (value) => `${Math.round(value * 100)}%`),
        this.slider(t, "panel.holdSeconds", "holdSeconds", (value) => `${value.toFixed(1)}s`),
        this.slider(t, "panel.smoothness", "smoothness", (value) => `${Math.round(value * 100)}%`),
      ]),
      element("div", { className: "section" }, [
        element("h3", { text: t("panel.view") }),
        this.check(t, "panel.showSkeleton", "showSkeleton"),
        this.check(t, "panel.showFretboard", "showFretboard"),
        this.check(t, "panel.showNoteNames", "showNoteNames"),
        this.check(t, "panel.trackNeck", "trackNeck"),
        this.check(t, "panel.autoDetect", "autoDetect"),
      ]),
      element("div", { className: "section" }, [
        element("h3", { text: t("panel.guidance") }),
        this.check(t, "panel.showFingerNumbers", "showFingerNumbers"),
        this.check(t, "panel.cameraGuidance", "cameraGuidance"),
        this.nextNotes(t),
        element("p", { className: "quiet", text: t("panel.mirrorNote") }),
      ]),
      this.languageSection(t),
    );
  }

  private choiceSection(
    t: Translate,
    titleKey: TranslationKey,
    key: "guitar" | "handedness",
    options: { value: string; label: string }[],
  ): HTMLElement {
    const choices = element("div", { className: "choices" });
    for (const option of options) {
      const button = element("button", { text: option.label, attrs: { type: "button" } });
      button.setAttribute("aria-pressed", String(this.settings[key] === option.value));
      button.addEventListener("click", () => {
        if (this.settings[key] === option.value) return;
        // Cast is safe: the options come from the same union the field holds.
        (this.settings[key] as string) = option.value;
        this.onChanged(key);
        this.render(t);
      });
      choices.append(button);
    }
    return element("div", { className: "section" }, [element("h3", { text: t(titleKey) }), choices]);
  }

  private slider(t: Translate, titleKey: TranslationKey, key: RangeKey, format: (value: number) => string): HTMLElement {
    const range = RANGES[key];
    const value = element("span", { className: "value", text: format(this.settings[key]) });
    const input = element("input", {
      attrs: {
        type: "range",
        min: String(range.min),
        max: String(range.max),
        step: String(range.step),
        value: String(this.settings[key]),
      },
    });
    input.addEventListener("input", () => {
      this.settings[key] = Number(input.value);
      value.textContent = format(this.settings[key]);
      this.onChanged(key);
    });
    return element("label", { className: "slider" }, [element("span", { text: t(titleKey) }), value, input]);
  }

  /** How many notes after the current one the song diagram shows: none, one or two. */
  private nextNotes(t: Translate): HTMLElement {
    const choices = element("div", { className: "choices" });
    for (const count of [0, 1, 2]) {
      const button = element("button", { text: String(count), attrs: { type: "button", "aria-pressed": String(this.settings.nextNotes === count) } });
      button.addEventListener("click", () => {
        if (this.settings.nextNotes === count) return;
        this.settings.nextNotes = count;
        this.onChanged("nextNotes");
        this.render(t);
      });
      choices.append(button);
    }
    return element("div", {}, [element("span", { className: "quiet", text: t("panel.nextNotes") }), choices]);
  }

  private check(
    t: Translate,
    titleKey: TranslationKey,
    key: "showSkeleton" | "showFretboard" | "showNoteNames" | "autoDetect" | "trackNeck" | "showFingerNumbers" | "cameraGuidance",
  ): HTMLElement {
    const input = element("input", { attrs: { type: "checkbox" } });
    input.checked = this.settings[key];
    input.addEventListener("change", () => {
      this.settings[key] = input.checked;
      this.onChanged(key);
    });
    return element("label", { className: "check" }, [input, element("span", { text: t(titleKey) })]);
  }

  private languageSection(t: Translate): HTMLElement {
    const choices = element("div", { className: "choices" });
    for (const code of LANGUAGES) {
      const button = element("button", { text: LOCALES[code].label, attrs: { type: "button" } });
      button.setAttribute("aria-pressed", String(this.settings.language === code));
      button.addEventListener("click", () => {
        if (this.settings.language === code) return;
        this.settings.language = code;
        this.onChanged("language");
      });
      choices.append(button);
    }
    return element("div", { className: "section" }, [element("h3", { text: t("panel.language") }), choices]);
  }
}
