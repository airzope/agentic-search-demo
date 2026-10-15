import type { Settings } from "meilisearch";

import type { KbConfig } from "@/lib/kb/types";

/** Name of the app-managed embedder holding Qwen3 vectors. */
export const QWEN3_EMBEDDER = "qwen3";

/** One Meilisearch document per chunk of a source file. */
export type ChunkDoc = {
  id: string;
  doc_id: string;
  chunk_index: number;
  chunk_count: number;
  title: string;
  path: string;
  dir: string;
  branch: string[];
  heading: string;
  content: string;
  file_type: string;
  source: string;
  mtime: number;
  size: number;
  _vectors?: Record<string, number[] | null>;
};

export const CHUNK_FILTERABLE = [
  "branch",
  "dir",
  "path",
  "doc_id",
  "chunk_index",
  "file_type",
];

export const SCALE_PRESETS = {
  standard: { chunkSize: 800, overlap: 100, dimensions: 1024 },
  large: { chunkSize: 1200, overlap: 150, dimensions: 512 },
} as const;

/** Index settings for a chunked knowledge base. */
export function buildKbSettings(config: KbConfig): Settings {
  const large = config.scale === "large";
  return {
    searchableAttributes: ["title", "heading", "content", "path"],
    filterableAttributes: CHUNK_FILTERABLE,
    sortableAttributes: ["mtime"],
    displayedAttributes: ["*"],
    faceting: {
      maxValuesPerFacet: large ? 20_000 : 5_000,
      sortFacetValuesBy: { "*": "alpha" },
    },
    pagination: { maxTotalHits: 2_000 },
    // byAttribute indexes much faster and uses less disk on large corpora.
    proximityPrecision: large ? "byAttribute" : "byWord",
    searchCutoffMs: large ? 1_500 : null,
    localizedAttributes: config.locales.length
      ? [
          {
            attributePatterns: ["title", "heading", "content", "path"],
            locales: config.locales,
          },
        ]
      : [],
    embedders: config.embedding.enabled
      ? {
          [QWEN3_EMBEDDER]: {
            source: "userProvided",
            dimensions: config.embedding.dimensions,
          },
        }
      : {},
  };
}

export type IndexSchema = {
  chunked: boolean;
  vector: { dimensions: number } | null;
  embedders: string[];
};

/** Recognize knowledge-base indexes by their settings, wherever they live. */
export function detectSchema(settings: Settings): IndexSchema {
  const filterable = (settings.filterableAttributes ?? []).map((attribute) =>
    typeof attribute === "string"
      ? attribute
      : attribute.attributePatterns.join(","),
  );
  const chunked = ["doc_id", "branch", "chunk_index"].every((field) =>
    filterable.some((attribute) => attribute.split(",").includes(field)),
  );
  const embedders = settings.embedders ?? {};
  const qwen3 = embedders[QWEN3_EMBEDDER];
  const vector =
    qwen3 && qwen3.source === "userProvided"
      ? { dimensions: qwen3.dimensions }
      : null;
  return {
    chunked,
    vector,
    embedders: Object.keys(embedders).filter((name) => name !== QWEN3_EMBEDDER),
  };
}

/** `a/b/c.md` → `["a", "a/b"]`: one filter selects a whole subtree. */
export function branchesOf(relativePath: string) {
  const parts = relativePath.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
