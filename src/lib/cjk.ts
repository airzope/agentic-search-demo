/** CJK helpers shared by server and client. */

/** Meilisearch locales offered in the UI (ISO 639-3, as Meilisearch expects). */
export const LOCALES = [
  { code: "cmn", label: "中文", htmlLang: "zh" },
  { code: "jpn", label: "日本語", htmlLang: "ja" },
  { code: "kor", label: "한국어", htmlLang: "ko" },
  { code: "eng", label: "English", htmlLang: "en" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

export const localeLabel = (code: string) =>
  LOCALES.find((locale) => locale.code === code)?.label ?? code;

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;

/**
 * Guess an HTML `lang` from text so the browser picks the right CJK glyphs
 * (the same Han character is drawn differently in zh / ja / ko fonts).
 */
export function guessLang(text: string): "zh" | "ja" | "ko" | undefined {
  if (!text) return undefined;
  const sample = text.slice(0, 400);
  if (KANA.test(sample)) return "ja";
  if (HANGUL.test(sample)) return "ko";
  if (HAN.test(sample)) return "zh";
  return undefined;
}

/** Map a guessed html lang to a Meilisearch locale. */
export function guessLocale(text: string): LocaleCode | undefined {
  const lang = guessLang(text);
  if (lang === "zh") return "cmn";
  if (lang === "ja") return "jpn";
  if (lang === "ko") return "kor";
  return undefined;
}

/** Private-use characters used as highlight tags (never appear in content). */
export const HIGHLIGHT_PRE = "\uE000";
export const HIGHLIGHT_POST = "\uE001";

export type HighlightPart = { text: string; hit: boolean };

/** Split a Meilisearch `_formatted` string into plain and highlighted parts. */
export function splitHighlights(value: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let hit = false;
  let buffer = "";
  for (const char of value) {
    if (char === HIGHLIGHT_PRE || char === HIGHLIGHT_POST) {
      if (buffer) parts.push({ text: buffer, hit });
      buffer = "";
      hit = char === HIGHLIGHT_PRE;
    } else {
      buffer += char;
    }
  }
  if (buffer) parts.push({ text: buffer, hit });
  return parts;
}

export const stripHighlights = (value: string) =>
  value.replaceAll(HIGHLIGHT_PRE, "").replaceAll(HIGHLIGHT_POST, "");

/** True when the keyboard event belongs to an IME composition (CJK input). */
export function isComposing(event: {
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  keyCode?: number;
}) {
  return Boolean(
    event.nativeEvent?.isComposing ||
    event.nativeEvent?.keyCode === 229 ||
    event.keyCode === 229,
  );
}
