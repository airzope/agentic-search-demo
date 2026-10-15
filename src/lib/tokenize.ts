import "server-only";

import type { Settings } from "meilisearch";

import { HIDDEN_INDEX_PREFIX, getMeili, settle } from "@/lib/meili";

/**
 * Engine-accurate tokenization preview.
 *
 * Meilisearch has no "analyze" endpoint, so we let it tell us where its own
 * tokens are: the text is indexed into a hidden scratch index that carries the
 * same tokenizer settings, then searched with itself as the query.
 * `_matchesPosition` returns byte ranges of matched tokens, which are real
 * token boundaries from charabia (jieba / lindera / …).
 *
 * Only the first 10 words of a query are used, so we query repeatedly from the
 * first uncovered position. Jieba's segmentation is suffix-optimal, so
 * restarting at a token boundary does not change the tokens that follow.
 */
const PREVIEW_INDEX = `${HIDDEN_INDEX_PREFIX}tokenizer_preview`;
export const MAX_PREVIEW_CHARS = 600;
const MAX_ROUNDS = 300;

export type TokenizerSettings = {
  dictionary?: string[];
  separatorTokens?: string[];
  nonSeparatorTokens?: string[];
  stopWords?: string[];
};

export type PreviewToken = {
  text: string;
  /** UTF-16 offsets into the input text. */
  start: number;
  end: number;
  kind: "word" | "stop" | "separator" | "unmatched";
  /** The token comes from the custom dictionary. */
  dictionary?: boolean;
};

let queue: Promise<unknown> = Promise.resolve();

/** Serialize previews: they share one scratch index. */
function exclusive<T>(fn: () => Promise<T>) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

const SEPARATOR_CHAR = /^[\p{P}\p{S}\p{Z}\p{C}\s]+$/u;

/** Order-insensitive fingerprint of the settings that affect tokenization. */
function fingerprint(settings: Settings) {
  const sorted = (values?: string[] | null) => [...(values ?? [])].sort();
  return JSON.stringify([
    settings.searchableAttributes,
    settings.displayedAttributes,
    settings.typoTolerance?.enabled,
    settings.prefixSearch,
    Object.keys(settings.synonyms ?? {}).length,
    sorted(settings.dictionary),
    sorted(settings.separatorTokens),
    sorted(settings.nonSeparatorTokens),
    sorted(settings.stopWords),
    settings.localizedAttributes ?? [],
  ]);
}

/** Make the scratch index carry `settings` and exactly one document. */
async function prepareScratchIndex(settings: Settings, text: string) {
  const client = await getMeili();
  const index = client.index(PREVIEW_INDEX);

  let current: Settings | null = null;
  try {
    current = await index.getSettings();
  } catch {
    await settle(client.createIndex(PREVIEW_INDEX, { primaryKey: "id" }));
  }
  if (!current || fingerprint(current) !== fingerprint(settings)) {
    await settle(index.updateSettings(settings));
  }

  let stored: string | undefined;
  try {
    stored = (await index.getDocument(1)).text as string | undefined;
  } catch {
    stored = undefined;
  }
  if (stored !== text) {
    await settle(index.addDocuments([{ id: 1, text }]));
  }
  return index;
}

export function previewTokens(
  text: string,
  tokenizer: TokenizerSettings,
  locale: string | null,
) {
  return exclusive(async () => {
    const index = await prepareScratchIndex(
      {
        searchableAttributes: ["text"],
        displayedAttributes: ["*"],
        typoTolerance: { enabled: false },
        prefixSearch: "disabled",
        synonyms: {},
        dictionary: tokenizer.dictionary ?? [],
        separatorTokens: tokenizer.separatorTokens ?? [],
        nonSeparatorTokens: tokenizer.nonSeparatorTokens ?? [],
        stopWords: tokenizer.stopWords ?? [],
        localizedAttributes: locale
          ? [{ attributePatterns: ["text"], locales: [locale] }]
          : [],
      },
      text,
    );

    const bytes = Buffer.from(text, "utf8");
    // Byte offset → UTF-16 offset for every code point boundary.
    const toUtf16 = new Map<number, number>();
    {
      let byte = 0;
      let unit = 0;
      for (const char of text) {
        toUtf16.set(byte, unit);
        byte += Buffer.byteLength(char, "utf8");
        unit += char.length;
      }
      toUtf16.set(byte, unit);
    }

    const tokens = new Map<number, number>(); // start byte → length
    let cursor = 0;
    let rounds = 0;

    const skipCovered = (from: number) => {
      let position = from;
      while (position < bytes.length) {
        const length = tokens.get(position);
        if (length) {
          position += length;
          continue;
        }
        // Advance over separator characters.
        const char = [
          ...bytes.subarray(position, position + 4).toString("utf8"),
        ][0];
        if (SEPARATOR_CHAR.test(char)) {
          position += Buffer.byteLength(char, "utf8");
          continue;
        }
        break;
      }
      return position;
    };

    while (cursor < bytes.length && rounds < MAX_ROUNDS) {
      rounds += 1;
      const query = bytes.subarray(cursor).toString("utf8");
      if (!query.trim()) break;

      const response = await index.search(query, {
        limit: 1,
        attributesToRetrieve: ["id"],
        showMatchesPosition: true,
        matchingStrategy: "last",
        locales: locale ? [locale] : undefined,
      });
      const matches =
        (
          response.hits[0]?._matchesPosition as
            Record<string, { start: number; length: number }[]> | undefined
        )?.text ?? [];
      for (const match of matches) {
        if (match.start >= cursor && match.length > 0) {
          tokens.set(
            match.start,
            Math.max(tokens.get(match.start) ?? 0, match.length),
          );
        }
      }

      const next = skipCovered(cursor);
      if (next > cursor) {
        cursor = next;
        continue;
      }
      // Nothing matched at the cursor (stop word or query/doc mismatch):
      // jump to the next known token, the gap becomes "unmatched".
      const following = [...tokens.keys()]
        .filter((start) => start > cursor)
        .sort((a, b) => a - b)[0];
      cursor = following ?? bytes.length;
    }

    // Build the output: tokens plus the gaps between them.
    const dictionary = new Set(
      (tokenizer.dictionary ?? []).map((word) => word.toLowerCase()),
    );
    const stopWords = new Set(
      (tokenizer.stopWords ?? []).map((word) => word.toLowerCase()),
    );
    const slice = (from: number, to: number) =>
      bytes.subarray(from, to).toString("utf8");
    const result: PreviewToken[] = [];
    const GAP_PARTS = /[\p{P}\p{S}\p{Z}\p{C}\s]+|[^\p{P}\p{S}\p{Z}\p{C}\s]+/gu;
    const pushGap = (fromByte: number, toByte: number) => {
      if (toByte <= fromByte) return;
      const gap = slice(fromByte, toByte);
      // Split a gap into separator runs and word-ish runs.
      for (const match of gap.matchAll(GAP_PARTS)) {
        const part = match[0];
        const startByte =
          fromByte + Buffer.byteLength(gap.slice(0, match.index), "utf8");
        const endByte = startByte + Buffer.byteLength(part, "utf8");
        result.push({
          text: part,
          start: toUtf16.get(startByte) ?? 0,
          end: toUtf16.get(endByte) ?? text.length,
          kind: SEPARATOR_CHAR.test(part)
            ? "separator"
            : stopWords.has(part.toLowerCase())
              ? "stop"
              : "unmatched",
        });
      }
    };

    let position = 0;
    for (const [start, length] of [...tokens].sort((a, b) => a[0] - b[0])) {
      if (start < position) continue; // overlapping match, keep the first
      pushGap(position, start);
      const value = slice(start, start + length);
      result.push({
        text: value,
        start: toUtf16.get(start) ?? 0,
        end: toUtf16.get(start + length) ?? text.length,
        kind: "word",
        dictionary: dictionary.has(value.toLowerCase()) || undefined,
      });
      position = start + length;
    }
    pushGap(position, bytes.length);

    return { tokens: result, rounds, truncated: rounds >= MAX_ROUNDS };
  });
}
