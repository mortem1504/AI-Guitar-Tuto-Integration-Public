/**
 * Four sentences about how the class works.
 *
 * Deliberately short. Someone holding a guitar is not going to read a manual,
 * and everything else is discoverable by pointing the camera at the neck.
 */

import { renderEmphasis, type Translate, type TranslationKey } from "../i18n";
import { clear, element, requireElement } from "./dom";

const BODY_KEYS: TranslationKey[] = ["help.body.1", "help.body.2", "help.body.3", "help.body.4"];

export class Help {
  private root = requireElement("help");
  private card = requireElement("help-card");
  private toggle = requireElement<HTMLButtonElement>("help-toggle");

  constructor(private t: () => Translate) {
    this.toggle.addEventListener("click", () => this.setOpen(this.root.classList.contains("gone")));
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) this.setOpen(false);
    });
  }

  setOpen(open: boolean) {
    this.root.classList.toggle("gone", !open);
    this.toggle.setAttribute("aria-pressed", String(open));
    if (open) this.render();
  }

  render() {
    const t = this.t();
    clear(this.card);
    this.card.append(element("h2", { text: t("help.title") }));

    for (const key of BODY_KEYS) {
      const line = element("p");
      line.append(renderEmphasis(t(key)));
      this.card.append(line);
    }

    const close = element("button", { className: "primary", text: t("help.close"), attrs: { type: "button" } });
    close.addEventListener("click", () => this.setOpen(false));
    this.card.append(close);
  }
}
