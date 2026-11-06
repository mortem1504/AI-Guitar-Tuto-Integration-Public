/**
 * A labelled choice of two or three, as buttons: pressed is the one in force.
 * Used wherever a setting is picked in place (practice mode, input, coaching).
 */

import { element } from "./dom";

export function segmented<T extends string>(label: string, options: [T, string][], value: T, set: (value: T) => void): HTMLElement {
  const group = element("div", { className: "segmented", attrs: { role: "group", "aria-label": label } });
  for (const [option, text] of options) {
    const button = element("button", { text, attrs: { type: "button", "aria-pressed": String(option === value) } });
    button.addEventListener("click", () => {
      if (option !== value) set(option);
    });
    group.append(button);
  }
  return element("div", { className: "notes-option" }, [element("span", { text: label }), group]);
}
