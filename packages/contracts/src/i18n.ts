/** Languages the UI and every AI-generated text are produced in. Adding one here makes the
 *  extraction schema, the prompts and the UI dictionaries require it (the type system flags them). */
export const LANGS = ['it', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'it';

/** A text the AI writes once per supported language (titles, notes, warnings, insights). */
export type LocalizedText = Record<Lang, string>;

/** Same text in every language — for values that are not translated (e.g. a user-typed note). */
export function sameInAllLangs(text: string): LocalizedText {
  return { it: text, en: text };
}

export function pickLang(text: LocalizedText, lang: Lang): string {
  return text[lang] || text[DEFAULT_LANG] || Object.values(text).find(Boolean) || '';
}
