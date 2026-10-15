/** Types shared by API routes and pages. */

export type SearchMode = "keyword" | "hybrid" | "semantic";

export type SearchPrefs = {
  mode: SearchMode;
  semanticRatio: number;
  embedder: string | null;
  /** Query locales; empty means "auto" (use the index languages). */
  locales: string[];
};

export type StatusInfo = {
  meilisearch:
    | { ok: true; host: string; version: string }
    | { ok: false; host: string; error: string };
  llm: { active: string | null };
};

export type ChatMetadata = { provider: string; model: string; deep?: boolean };
