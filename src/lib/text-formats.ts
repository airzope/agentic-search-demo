/**
 * Line-based text formats used by the tokenization editors.
 * Plain text is easy to bulk-paste from spreadsheets or existing dictionaries.
 */
import type { LocalizedAttribute } from "meilisearch";

/** One entry per line; blank lines and `#` comments ignored; deduplicated. */
export function parseLines(text: string) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // jieba-style dictionaries ("word freq tag"): keep the first column.
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const word =
      /\s/.test(line) && /\s\d+(\s|$)/.test(line) ? line.split(/\s+/)[0] : line;
    if (!seen.has(word)) {
      seen.add(word);
      result.push(word);
    }
  }
  return result;
}

export const formatLines = (values: readonly string[] | null | undefined) =>
  (values ?? []).join("\n");

const splitList = (text: string) =>
  text
    .split(/[,，、]/)
    .map((value) => value.trim())
    .filter(Boolean);

export type SynonymParseResult = {
  synonyms: Record<string, string[]>;
  errors: { line: number; text: string }[];
};

/**
 * Solr-style synonyms:
 *   `a, b, c`        → mutual (every word maps to the others)
 *   `a, b => c, d`   → one-way (a and b also match c and d)
 */
export function parseSynonyms(text: string): SynonymParseResult {
  const map = new Map<string, Set<string>>();
  const errors: SynonymParseResult["errors"] = [];
  const add = (from: string, to: string) => {
    if (from === to) return;
    if (!map.has(from)) map.set(from, new Set());
    map.get(from)!.add(to);
  };

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const arrow = line.split(/=>|⇒|→/);
    if (arrow.length === 2) {
      const left = splitList(arrow[0]);
      const right = splitList(arrow[1]);
      if (!left.length || !right.length) {
        errors.push({ line: index + 1, text: raw });
        return;
      }
      for (const from of left) for (const to of right) add(from, to);
    } else if (arrow.length === 1) {
      const words = splitList(line);
      if (words.length < 2) {
        errors.push({ line: index + 1, text: raw });
        return;
      }
      for (const from of words) for (const to of words) add(from, to);
    } else {
      errors.push({ line: index + 1, text: raw });
    }
  });

  return {
    synonyms: Object.fromEntries(
      [...map].map(([key, values]) => [key, [...values]]),
    ),
    errors,
  };
}

/** Inverse of parseSynonyms: collapse fully mutual groups to `a, b, c`. */
export function formatSynonyms(
  synonyms: Record<string, string[]> | null | undefined,
) {
  const map = new Map(
    Object.entries(synonyms ?? {}).map(([key, values]) => [
      key,
      new Set(values),
    ]),
  );
  const done = new Set<string>();
  const lines: string[] = [];

  for (const [key, values] of map) {
    if (done.has(key)) continue;
    const group = [key, ...values];
    const mutual = group.every((word) => {
      const targets = map.get(word);
      return (
        targets !== undefined &&
        targets.size === group.length - 1 &&
        group.every((other) => other === word || targets.has(other))
      );
    });
    if (mutual) {
      group.forEach((word) => done.add(word));
      lines.push(group.join(", "));
    }
  }

  for (const [key, values] of map) {
    if (done.has(key)) continue;
    lines.push(`${key} => ${[...values].join(", ")}`);
  }

  return lines.join("\n");
}

/** `title, content => cmn, eng` per line. */
export function parseLocalizedAttributes(text: string): {
  rules: LocalizedAttribute[];
  errors: { line: number; text: string }[];
} {
  const rules: LocalizedAttribute[] = [];
  const errors: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/=>|⇒|→/);
    const patterns = parts.length === 2 ? splitList(parts[0]) : [];
    const locales = parts.length === 2 ? splitList(parts[1]) : [];
    if (!patterns.length || !locales.length) {
      errors.push({ line: index + 1, text: raw });
      return;
    }
    rules.push({ attributePatterns: patterns, locales });
  });
  return { rules, errors };
}

export function formatLocalizedAttributes(
  rules: readonly LocalizedAttribute[] | null | undefined,
) {
  return (rules ?? [])
    .map(
      (rule) =>
        `${rule.attributePatterns.join(", ")} => ${rule.locales.join(", ")}`,
    )
    .join("\n");
}
