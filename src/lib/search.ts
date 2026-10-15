import "server-only";

import type { Index, SearchParams } from "meilisearch";

import { HIGHLIGHT_POST, HIGHLIGHT_PRE } from "@/lib/cjk";
import { inferDisplayFields } from "@/lib/display";
import { getMeili } from "@/lib/meili";
import type { SearchMode, SearchPrefs } from "@/lib/types";

export function hybridFor(prefs: Partial<SearchPrefs>) {
  const mode: SearchMode = prefs.mode ?? "keyword";
  if (mode === "keyword" || !prefs.embedder) return undefined;
  const ratio =
    mode === "semantic"
      ? 1
      : Math.min(1, Math.max(0, Number(prefs.semanticRatio ?? 0.5)));
  return { embedder: prefs.embedder, semanticRatio: ratio };
}

export function buildSearchParams(
  prefs: Partial<SearchPrefs>,
  extra: SearchParams = {},
): SearchParams {
  return {
    attributesToHighlight: ["*"],
    attributesToCrop: ["*"],
    cropLength: 40,
    cropMarker: "…",
    highlightPreTag: HIGHLIGHT_PRE,
    highlightPostTag: HIGHLIGHT_POST,
    showRankingScore: true,
    hybrid: hybridFor(prefs),
    locales: prefs.locales?.length ? prefs.locales : undefined,
    ...extra,
  };
}

/** Index metadata needed to render or describe documents. */
export async function describeIndex(index: Index) {
  const [info, stats, settings, sample] = await Promise.all([
    index.getRawInfo(),
    index.getStats(),
    index.getSettings(),
    index.getDocuments({ limit: 5 }),
  ]);
  const fields = Object.keys(stats.fieldDistribution ?? {});
  return {
    uid: info.uid,
    primaryKey: info.primaryKey ?? null,
    createdAt: info.createdAt,
    updatedAt: info.updatedAt,
    stats,
    settings,
    fields,
    display: inferDisplayFields(
      fields,
      sample.results as Record<string, unknown>[],
    ),
  };
}

export async function getIndex(uid: string) {
  return (await getMeili()).index(uid);
}

/** Default query locales: the locales declared in `localizedAttributes`. */
export function defaultLocales(
  localized: { locales: string[] }[] | null | undefined,
) {
  const all = (localized ?? []).flatMap((rule) => rule.locales);
  return [...new Set(all)];
}
