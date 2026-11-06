/**
 * Translation. Small enough not to need a library: a table per language, a
 * lookup, and `{placeholder}` substitution.
 *
 * Note naming differs between the two: English-speaking musicians write C, D,
 * E, while most of Europe and Latin America says Do, Re, Mi. Both are always
 * shown, but each language leads with the one its players read faster.
 */

import { enDictionary, type Dictionary, type TranslationKey } from "./en";
import { esDictionary } from "./es";

export type Language = "en" | "es";

export interface Locale {
  code: Language;
  /** Written in its own language, the way language pickers should be. */
  label: string;
  /** Which naming the big on-screen label uses. */
  notation: "letter" | "solfege";
  dictionary: Dictionary;
}

export const LOCALES: Record<Language, Locale> = {
  en: { code: "en", label: "English", notation: "letter", dictionary: enDictionary },
  es: { code: "es", label: "Español", notation: "solfege", dictionary: esDictionary },
};

export const LANGUAGES = Object.keys(LOCALES) as Language[];

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

/** Picks a language from the browser's settings, falling back to English. */
export function detectLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return "en";
}

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function createTranslator(language: Language): Translate {
  const { dictionary } = LOCALES[language];
  return (key, params) => {
    let text: string = dictionary[key] ?? enDictionary[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}

/**
 * The legend marks emphasis with **asterisks** so the translations stay plain
 * text. This turns that into a safe DOM fragment — no innerHTML anywhere, so a
 * translation string can never inject markup.
 */
export function renderEmphasis(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const [i, part] of text.split("**").entries()) {
    if (!part) continue;
    if (i % 2 === 1) {
      const strong = document.createElement("b");
      strong.textContent = part;
      fragment.append(strong);
    } else {
      fragment.append(document.createTextNode(part));
    }
  }
  return fragment;
}

export type { TranslationKey, Dictionary };
