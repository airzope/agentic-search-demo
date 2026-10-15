import "server-only";

import type {
  FederatedMultiSearchParams,
  MultiSearchQueryWithFederation,
} from "meilisearch";

import { HIGHLIGHT_POST, HIGHLIGHT_PRE } from "@/lib/cjk";
import { fieldText } from "@/lib/display";
import { embedQuery, truncate } from "@/lib/embedding";
import { builtinStatus } from "@/lib/embedding/builtin";
import {
  describeKb,
  vectorCompatible,
  type KbDescription,
} from "@/lib/kb/catalog";
import { QWEN3_EMBEDDER } from "@/lib/kb/schema";
import { getMeili, parseKbId } from "@/lib/meili";
import { defaultLocales } from "@/lib/search";
import { getEmbeddingConfig } from "@/lib/settings";
import type { SearchPrefs } from "@/lib/types";

/** A search hit from any knowledge base, normalized for display and for the LLM. */
export type KbHit = {
  ref: string;
  kbId: string;
  kbName: string;
  connectionId: string;
  id: string;
  docId: string;
  chunkIndex: number | null;
  chunkCount: number | null;
  title: string;
  path: string | null;
  heading: string | null;
  /** Highlighted (private-use markers) title and snippet. */
  titleHighlighted: string;
  snippet: string;
  score: number;
  fields: Record<string, string>;
  document: Record<string, unknown>;
};

export type RetrieveParams = {
  kbIds: string[];
  q: string;
  prefs?: Partial<SearchPrefs>;
  /** Subtree filter for chunked knowledge bases, e.g. "产品/手册". */
  branch?: string | null;
  /** Extra Meilisearch filter; only applied when one KB is searched. */
  filter?: string | (string | string[])[];
  facets?: string[];
  limit?: number;
  offset?: number;
  cropLength?: number;
};

export type RetrieveResult = {
  hits: KbHit[];
  estimatedTotalHits: number;
  processingTimeMs: number;
  semanticHitCount?: number;
  facetDistribution?: Record<string, Record<string, number>>;
  errors: { scope: string; message: string }[];
  warnings: string[];
};

export const refOf = (kbId: string, docId: string, chunk: number | null) =>
  chunk === null ? `${kbId}~${docId}` : `${kbId}~${docId}~${chunk}`;

export function parseRef(ref: string) {
  const [kbId, docId, chunk] = ref.split("~");
  if (!kbId || !docId) return null;
  return {
    kbId,
    docId,
    chunk: chunk !== undefined && /^\d+$/.test(chunk) ? Number(chunk) : null,
  };
}

const quote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** Is a query vector obtainable without triggering a large download? */
async function canEmbedQueries() {
  const config = await getEmbeddingConfig();
  if (config.engine === "remote")
    return Boolean(config.remote.baseURL && config.remote.model);
  const status = await builtinStatus();
  return (
    status.state !== "missing" &&
    status.state !== "downloading" &&
    status.state !== "error"
  );
}

function toHit(
  kb: KbDescription,
  raw: Record<string, unknown>,
  score: number,
): KbHit {
  const formatted = (raw._formatted ?? {}) as Record<string, unknown>;
  const document = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith("_")),
  );
  const primaryKey = kb.primaryKey ?? "id";
  const id = fieldText(raw[primaryKey]);
  if (kb.schema.chunked) {
    const docId = fieldText(raw.doc_id);
    const chunkIndex =
      typeof raw.chunk_index === "number" ? raw.chunk_index : 0;
    return {
      ref: refOf(kb.id, docId, chunkIndex),
      kbId: kb.id,
      kbName: kb.name,
      connectionId: kb.connectionId,
      id,
      docId,
      chunkIndex,
      chunkCount: typeof raw.chunk_count === "number" ? raw.chunk_count : null,
      title: fieldText(raw.title),
      path: fieldText(raw.path) || null,
      heading: fieldText(raw.heading) || null,
      titleHighlighted: fieldText(formatted.title ?? raw.title),
      snippet: fieldText(formatted.content ?? raw.content),
      score,
      fields: {},
      document,
    };
  }
  const { title, content } = kb.display;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(document)) {
    if ([primaryKey, title, content].includes(key)) continue;
    const text = fieldText(value);
    if (text && text.length <= 60 && Object.keys(fields).length < 4)
      fields[key] = text;
  }
  return {
    ref: refOf(kb.id, id, null),
    kbId: kb.id,
    kbName: kb.name,
    connectionId: kb.connectionId,
    id,
    docId: id,
    chunkIndex: null,
    chunkCount: null,
    title: title ? fieldText(raw[title]) : "",
    path: null,
    heading: null,
    titleHighlighted: title ? fieldText(formatted[title] ?? raw[title]) : "",
    snippet: content ? fieldText(formatted[content] ?? raw[content]) : "",
    score,
    fields,
    document,
  };
}

/** Federated search across knowledge bases on one or more Meilisearch instances. */
export async function retrieve(
  params: RetrieveParams,
): Promise<RetrieveResult> {
  const started = Date.now();
  const prefs = params.prefs ?? {};
  const mode = prefs.mode ?? "keyword";
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const errors: RetrieveResult["errors"] = [];
  const warnings: string[] = [];
  const single = params.kbIds.length === 1;

  // Describe every KB (cached); unreachable ones become errors.
  const described = await Promise.all(
    [...new Set(params.kbIds)].map(async (id) => {
      try {
        return await describeKb(parseKbId(id).id);
      } catch (error) {
        errors.push({
          scope: id,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }),
  );
  const kbs = described.filter((kb): kb is KbDescription => kb !== null);

  // One query vector for every KB that stores app-managed Qwen3 vectors.
  let queryVector: number[] | null = null;
  const wantsVectors = mode !== "keyword" && params.q.trim().length > 0;
  const vectorKbs = new Set<string>();
  if (wantsVectors) {
    for (const kb of kbs) {
      if (!kb.schema.vector) continue;
      if (await vectorCompatible(kb)) vectorKbs.add(kb.id);
      else
        warnings.push(
          `${kb.name}: vectors were built with another embedding model; using keyword search`,
        );
    }
    if (vectorKbs.size) {
      if (await canEmbedQueries()) {
        try {
          queryVector = await embedQuery(params.q);
        } catch (error) {
          warnings.push(
            `Embedding unavailable, using keyword search: ${(error as Error).message}`,
          );
        }
      } else {
        warnings.push(
          "The built-in Qwen3 embedding model is not downloaded yet; using keyword search",
        );
      }
    }
  }

  const queryFor = (kb: KbDescription): MultiSearchQueryWithFederation => {
    const filters: (string | string[])[] = [];
    if (kb.schema.chunked && params.branch)
      filters.push(`branch = ${quote(params.branch)}`);
    if (single && params.filter) {
      filters.push(
        ...(Array.isArray(params.filter) ? params.filter : [params.filter]),
      );
    }
    let hybrid: MultiSearchQueryWithFederation["hybrid"];
    let vector: number[] | undefined;
    if (wantsVectors) {
      const ratio =
        mode === "semantic"
          ? 1
          : Math.min(1, Math.max(0, prefs.semanticRatio ?? 0.5));
      if (vectorKbs.has(kb.id) && queryVector && kb.schema.vector) {
        hybrid = { embedder: QWEN3_EMBEDDER, semanticRatio: ratio };
        vector = truncate(queryVector, kb.schema.vector.dimensions);
      } else if (kb.schema.embedders.length) {
        const embedder =
          prefs.embedder && kb.schema.embedders.includes(prefs.embedder)
            ? prefs.embedder
            : kb.schema.embedders[0];
        hybrid = { embedder, semanticRatio: ratio };
      }
    }
    const locales = prefs.locales?.length
      ? prefs.locales
      : defaultLocales(kb.settings.localizedAttributes);
    const chunked = kb.schema.chunked;
    return {
      indexUid: kb.uid,
      q: params.q,
      filter: filters.length ? filters : undefined,
      hybrid,
      vector,
      locales: locales.length ? locales : undefined,
      distinct: chunked ? "doc_id" : undefined,
      attributesToHighlight: chunked ? ["title", "heading", "content"] : ["*"],
      attributesToCrop: chunked ? ["content"] : ["*"],
      cropLength: params.cropLength ?? 48,
      cropMarker: "…",
      highlightPreTag: HIGHLIGHT_PRE,
      highlightPostTag: HIGHLIGHT_POST,
      showRankingScore: true,
    };
  };

  // Group by connection: one federated multi-search per Meilisearch instance.
  const groups = new Map<string, KbDescription[]>();
  for (const kb of kbs) {
    groups.set(kb.connectionId, [...(groups.get(kb.connectionId) ?? []), kb]);
  }

  let estimatedTotalHits = 0;
  let semanticHitCount: number | undefined;
  let facetDistribution: RetrieveResult["facetDistribution"];
  const merged: KbHit[] = [];

  await Promise.all(
    [...groups].map(async ([connectionId, group]) => {
      const byUid = new Map(group.map((kb) => [kb.uid, kb]));
      try {
        const client = await getMeili(connectionId);
        const request: FederatedMultiSearchParams = {
          federation: {
            limit: offset + limit,
            offset: 0,
            ...(single && params.facets?.length
              ? { facetsByIndex: { [group[0].uid]: params.facets } }
              : {}),
          },
          queries: group.map(queryFor),
        };
        const response = (await client.multiSearch(request)) as unknown as {
          hits: Record<string, unknown>[];
          estimatedTotalHits?: number;
          semanticHitCount?: number;
          facetsByIndex?: Record<
            string,
            { distribution: Record<string, Record<string, number>> }
          >;
        };
        estimatedTotalHits +=
          response.estimatedTotalHits ?? response.hits.length;
        if (typeof response.semanticHitCount === "number") {
          semanticHitCount =
            (semanticHitCount ?? 0) + response.semanticHitCount;
        }
        if (single && response.facetsByIndex) {
          facetDistribution =
            response.facetsByIndex[group[0].uid]?.distribution;
        }
        for (const raw of response.hits) {
          const federation = raw._federation as
            { indexUid: string; weightedRankingScore: number } | undefined;
          const kb = federation ? byUid.get(federation.indexUid) : group[0];
          if (!kb) continue;
          merged.push(
            toHit(
              kb,
              raw,
              federation?.weightedRankingScore ??
                Number(raw._rankingScore ?? 0),
            ),
          );
        }
      } catch (error) {
        errors.push({
          scope: connectionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  merged.sort((a, b) => b.score - a.score);
  return {
    hits: merged.slice(offset, offset + limit),
    estimatedTotalHits,
    processingTimeMs: Date.now() - started,
    semanticHitCount,
    facetDistribution,
    errors,
    warnings,
  };
}
