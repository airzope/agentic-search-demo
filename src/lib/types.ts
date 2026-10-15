/** Types shared by API routes and pages. */
import type { IndexStats, Settings, Task } from "meilisearch";

import type { DisplayFields } from "@/lib/display";

export type SearchMode = "keyword" | "hybrid" | "semantic";

export type SearchPrefs = {
  mode: SearchMode;
  semanticRatio: number;
  embedder: string | null;
  /** Query locales; empty means "auto" (use the index languages). */
  locales: string[];
};

export type IndexSummary = {
  uid: string;
  primaryKey: string | null;
  createdAt: string;
  updatedAt: string;
  numberOfDocuments: number;
  isIndexing: boolean;
};

export type IndexDetail = {
  uid: string;
  primaryKey: string | null;
  createdAt: string;
  updatedAt: string;
  stats: IndexStats;
  settings: Settings;
  fields: string[];
  display: DisplayFields;
};

export type SearchHit = Record<string, unknown> & {
  _formatted?: Record<string, unknown>;
  _rankingScore?: number;
};

export type SearchResult = {
  hits: SearchHit[];
  query: string;
  processingTimeMs: number;
  estimatedTotalHits?: number;
  semanticHitCount?: number;
  facetDistribution?: Record<string, Record<string, number>>;
};

export type TaskInfo = Pick<
  Task,
  | "uid"
  | "indexUid"
  | "status"
  | "type"
  | "error"
  | "duration"
  | "enqueuedAt"
  | "finishedAt"
  | "details"
>;

export type StatusInfo = {
  meilisearch:
    | { ok: true; host: string; version: string }
    | { ok: false; host: string; error: string };
  llm: { active: string | null };
};

/** Compact search hit returned to the LLM and shown in chat. */
export type ChatHit = {
  id: string;
  title: string;
  snippet: string;
  score?: number;
  fields?: Record<string, string>;
};

export type ChatMetadata = { provider: string; model: string };
