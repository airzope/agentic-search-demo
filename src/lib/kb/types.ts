/** Knowledge-base types shared by API routes and pages. */
import type { IndexStats, Settings } from "meilisearch";

import type { DisplayFields } from "@/lib/display";

export type DirectorySource = {
  type: "directory";
  /** Absolute path on the machine running the app. */
  path: string;
  /** Extensions to index (without dots); empty means every supported type. */
  include: string[];
  /** Glob patterns: `node_modules`, `*.tmp`, `drafts/**`. */
  exclude: string[];
  /** OCR standalone images and scanned PDFs with PaddleOCR. */
  ocrImages: boolean;
  /** Also OCR images embedded in Word/PowerPoint files (slower). */
  ocrEmbedded: boolean;
  /** Re-sync automatically when files change. */
  watch: boolean;
  maxFileSizeMb: number;
};

/** Files uploaded in the browser, stored under `.data/kb/<id>/files`. */
export type ManagedSource = {
  type: "managed";
  ocrImages: boolean;
  ocrEmbedded: boolean;
  maxFileSizeMb: number;
};

export type KbSource = DirectorySource | ManagedSource;

export type KbConfig = {
  id: string;
  connectionId: string;
  indexUid: string;
  name: string;
  description: string;
  /** Meilisearch locales for `localizedAttributes`, e.g. ["cmn"]. */
  locales: string[];
  embedding: {
    enabled: boolean;
    dimensions: number;
    /** Model the vectors were made with; mismatches fall back to keyword search. */
    model: string | null;
  };
  chunk: { size: number; overlap: number };
  scale: "standard" | "large";
  source: KbSource;
  createdAt: string;
};

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export type JobInfo = {
  id: string;
  kbId: string;
  status: JobStatus;
  phase: "queued" | "scan" | "process" | "commit" | "done";
  force: boolean;
  /** Re-index every file from scratch (also after an embedding model change). */
  rebuild: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  skipped: number;
  added: number;
  updated: number;
  deleted: number;
  failed: number;
  chunks: number;
  current: string | null;
  errors: { path: string; message: string }[];
  warnings: string[];
  message: string | null;
};

export type KbSummary = {
  id: string;
  connectionId: string;
  connectionName: string;
  indexUid: string;
  name: string;
  description: string;
  /** Meilisearch documents (= chunks for chunked knowledge bases). */
  documents: number;
  isIndexing: boolean;
  /** Has the chunk schema (doc_id, branch, …). */
  chunked: boolean;
  /** The app-managed Qwen3 vectors, if any. */
  vector: { dimensions: number } | null;
  /** Other (custom) embedders configured on the index. */
  embedders: string[];
  config: KbConfig | null;
  job: JobInfo | null;
};

export type ConnectionStatus = {
  id: string;
  name: string;
  host: string;
  ok: boolean;
  error?: string;
};

export type TreeNode = { branch: string; name: string; docs: number };

export type KbDocument = {
  doc_id: string;
  title: string;
  path: string;
  file_type?: string;
  chunk_count?: number;
  mtime?: number;
};

/** GET /api/kb/[id] */
export type KbDetail = {
  id: string;
  connectionId: string;
  connectionName: string;
  name: string;
  uid: string;
  primaryKey: string | null;
  createdAt: string;
  updatedAt: string;
  stats: IndexStats;
  settings: Settings;
  fields: string[];
  display: DisplayFields;
  schema: {
    chunked: boolean;
    vector: { dimensions: number } | null;
    embedders: string[];
  };
  config: KbConfig | null;
  root: string | null;
  lastSync: {
    finishedAt: string;
    status: JobStatus;
    files: number;
    chunks: number;
    failed: number;
  } | null;
  failedFiles: { path: string; message: string }[];
  job: JobInfo | null;
};
