import "server-only";

import { createHash } from "node:crypto";
import {
  mkdir,
  opendir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { Index } from "meilisearch";

import {
  currentEmbeddingModel,
  embedDocuments,
  truncate,
} from "@/lib/embedding";
import { chunkMarkdown } from "@/lib/kb/chunk";
import { SkipFile, convertFile } from "@/lib/kb/convert";
import {
  DEFAULT_EXCLUDE,
  SUPPORTED_EXTENSIONS,
  compileExcludes,
  extensionOf,
  kindOf,
} from "@/lib/kb/formats";
import {
  getKbConfig,
  kbDir,
  managedFilesDir,
  saveKbConfig,
} from "@/lib/kb/registry";
import {
  QWEN3_EMBEDDER,
  branchesOf,
  buildKbSettings,
  type ChunkDoc,
} from "@/lib/kb/schema";
import type { JobInfo, KbConfig } from "@/lib/kb/types";
import { getKbIndex } from "@/lib/meili";

/* ------------------------------------------------------------ manifest */

type ManifestEntry = {
  size: number;
  mtimeMs: number;
  docId: string;
  chunks: number;
  status: "ok" | "failed" | "skipped";
  message?: string;
};

export type Manifest = {
  version: 1;
  files: Record<string, ManifestEntry>;
  lastSync: {
    finishedAt: string;
    status: JobInfo["status"];
    files: number;
    chunks: number;
    failed: number;
  } | null;
};

const manifestPath = (kbId: string) => path.join(kbDir(kbId), "manifest.json");

export async function readManifest(kbId: string): Promise<Manifest> {
  try {
    const data = JSON.parse(await readFile(manifestPath(kbId), "utf8"));
    return {
      version: 1,
      files: data.files ?? {},
      lastSync: data.lastSync ?? null,
    };
  } catch {
    return { version: 1, files: {}, lastSync: null };
  }
}

async function writeManifest(kbId: string, manifest: Manifest) {
  await mkdir(kbDir(kbId), { recursive: true });
  const file = manifestPath(kbId);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest));
  await rename(tmp, file);
}

/* ---------------------------------------------------------------- scan */

type ScannedFile = { rel: string; abs: string; size: number; mtimeMs: number };

export function sourceRoot(config: KbConfig) {
  return config.source.type === "directory"
    ? config.source.path
    : managedFilesDir(config.id);
}

async function scan(
  root: string,
  config: KbConfig,
  job: JobInfo,
  signal: AbortSignal,
): Promise<ScannedFile[]> {
  const source = config.source;
  const include = new Set(
    (source.type === "directory" && source.include.length
      ? source.include
      : SUPPORTED_EXTENSIONS
    ).map((extension) => extension.toLowerCase().replace(/^\./, "")),
  );
  const isExcluded = compileExcludes([
    ...DEFAULT_EXCLUDE,
    ...(source.type === "directory" ? source.exclude : []),
  ]);
  const maxBytes = source.maxFileSizeMb * 1024 * 1024;
  const files: ScannedFile[] = [];
  let oversized = 0;

  async function walk(dir: string, rel: string) {
    let handle;
    try {
      handle = await opendir(dir);
    } catch (error) {
      job.errors.push({
        path: rel || ".",
        message: `Cannot read directory: ${(error as Error).message}`,
      });
      return;
    }
    for await (const entry of handle) {
      if (signal.aborted) return;
      // Hidden files and folders (.git, .obsidian, …) are skipped.
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isExcluded(childRel)) continue;
      const childAbs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        if (
          !include.has(extensionOf(childRel)) ||
          kindOf(childRel) === "unsupported"
        )
          continue;
        const info = await stat(childAbs).catch(() => null);
        if (!info) continue;
        if (info.size > maxBytes) {
          oversized += 1;
          continue;
        }
        files.push({
          rel: childRel,
          abs: childAbs,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
        job.total = files.length;
      }
    }
  }

  await walk(root, "");
  if (oversized) {
    job.warnings.push(
      `${oversized} files larger than ${source.maxFileSizeMb} MB were skipped`,
    );
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ------------------------------------------------------------- helpers */

export const docIdOf = (rel: string) =>
  createHash("sha1").update(rel).digest("hex").slice(0, 20);

/** Errors that affect every file (e.g. the embedding model is unavailable). */
class FatalSyncError extends Error {}

const quote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const FLUSH_DOCS = 500;
const FLUSH_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 3;
const MAX_ERRORS = 200;

/** Batches writes; manifest entries are committed only after their docs are enqueued. */
class Writer {
  private docs: ChunkDoc[] = [];
  private bytes = 0;
  private entries: [string, ManifestEntry][] = [];
  readonly taskUids: number[] = [];

  constructor(
    private index: Index,
    private manifest: Manifest,
    private kbId: string,
  ) {}

  async deleteDocs(docIds: string[]) {
    for (let start = 0; start < docIds.length; start += 200) {
      const ids = docIds.slice(start, start + 200);
      const task = await this.index.deleteDocuments({
        filter: `doc_id IN [${ids.map(quote).join(", ")}]`,
      });
      this.taskUids.push(task.taskUid);
    }
  }

  async add(rel: string, entry: ManifestEntry, docs: ChunkDoc[]) {
    this.docs.push(...docs);
    this.bytes += docs.reduce(
      (total, doc) => total + doc.content.length * 3 + 2048,
      0,
    );
    this.entries.push([rel, entry]);
    if (this.docs.length >= FLUSH_DOCS || this.bytes >= FLUSH_BYTES)
      await this.flush();
  }

  /** Record a file that produced no documents (skipped / failed). */
  note(rel: string, entry: ManifestEntry) {
    this.entries.push([rel, entry]);
  }

  async flush() {
    if (this.docs.length) {
      const task = await this.index.addDocuments(this.docs, {
        primaryKey: "id",
      });
      this.taskUids.push(task.taskUid);
    }
    for (const [rel, entry] of this.entries) this.manifest.files[rel] = entry;
    this.docs = [];
    this.bytes = 0;
    this.entries = [];
    await writeManifest(this.kbId, this.manifest);
  }
}

/* ---------------------------------------------------------------- run */

export async function runSync(
  config: KbConfig,
  job: JobInfo,
  signal: AbortSignal,
) {
  const root = sourceRoot(config);
  if (config.source.type === "managed") await mkdir(root, { recursive: true });
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Directory not found: ${root}`);

  const { index, client } = await getKbIndex(config.id);
  const manifest = await readManifest(config.id);
  const writer = new Writer(index, manifest, config.id);

  // Vectors from different models are not comparable: re-embed everything.
  let rebuild = job.rebuild;
  if (config.embedding.enabled) {
    const model = await currentEmbeddingModel();
    if (config.embedding.model !== model) {
      if (config.embedding.model) {
        job.warnings.push(
          `Embedding model changed (${config.embedding.model} → ${model}); re-indexing every file`,
        );
        rebuild = true;
      }
      config.embedding.model = model;
      // Patch only this field: the registration may have changed meanwhile.
      const fresh = await getKbConfig(config.id);
      if (fresh)
        await saveKbConfig({
          ...fresh,
          embedding: { ...fresh.embedding, model },
        });
    }
  }
  if (rebuild) {
    job.phase = "scan";
    const cleared = await index.deleteAllDocuments();
    await client.tasks.waitForTask(cleared.taskUid, {
      timeout: 0,
      interval: 500,
    });
    const applied = await index.updateSettings(buildKbSettings(config));
    await client.tasks.waitForTask(applied.taskUid, {
      timeout: 0,
      interval: 500,
    });
    manifest.files = {};
    await writeManifest(config.id, manifest);
  }

  // 1. Scan and diff against the manifest.
  job.phase = "scan";
  const files = await scan(root, config, job, signal);
  const seen = new Set(files.map((file) => file.rel));
  const removed = Object.entries(manifest.files).filter(
    ([rel]) => !seen.has(rel),
  );
  const pending = files.filter((file) => {
    const previous = manifest.files[file.rel];
    if (!previous) return true;
    if (previous.size !== file.size || previous.mtimeMs !== file.mtimeMs)
      return true;
    return job.force && previous.status !== "ok";
  });
  job.skipped = files.length - pending.length;
  job.total = files.length;
  job.processed = job.skipped;

  // 2. Remove documents of deleted files.
  if (removed.length) {
    await writer.deleteDocs(removed.map(([, entry]) => entry.docId));
    for (const [rel] of removed) delete manifest.files[rel];
    job.deleted = removed.length;
    await writeManifest(config.id, manifest);
  }

  // 3. Convert → chunk → embed → write, a few files at a time.
  job.phase = "process";
  const dimensions = config.embedding.dimensions;
  const source = config.source;

  const processFile = async (file: ScannedFile) => {
    const previous = manifest.files[file.rel];
    const docId = docIdOf(file.rel);
    const base = { size: file.size, mtimeMs: file.mtimeMs, docId };
    job.current = file.rel;
    try {
      const converted = await convertFile(file.abs, file.rel, {
        ocrImages: source.ocrImages,
        ocrEmbedded: source.ocrEmbedded,
        signal: stop.signal,
      });
      for (const warning of converted.warnings)
        job.warnings.push(`${file.rel}: ${warning}`);
      const chunks = chunkMarkdown(converted.markdown, config.chunk);
      const dir = file.rel.includes("/")
        ? file.rel.slice(0, file.rel.lastIndexOf("/"))
        : "";
      const docs: ChunkDoc[] = chunks.map((chunk, chunkIndex) => ({
        id: `${docId}_${chunkIndex}`,
        doc_id: docId,
        chunk_index: chunkIndex,
        chunk_count: chunks.length,
        title: converted.title,
        path: file.rel,
        dir,
        branch: branchesOf(file.rel),
        heading: chunk.heading,
        content: chunk.content,
        file_type: extensionOf(file.rel),
        source: converted.source,
        mtime: Math.round(file.mtimeMs),
        size: file.size,
      }));

      if (config.embedding.enabled && docs.length) {
        let vectors: number[][];
        try {
          vectors = await embedDocuments(
            docs.map((doc) =>
              [doc.title, doc.heading, doc.content].filter(Boolean).join("\n"),
            ),
          );
        } catch (error) {
          throw new FatalSyncError(
            `Embedding failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        docs.forEach((doc, at) => {
          doc._vectors = {
            [QWEN3_EMBEDDER]: truncate(vectors[at], dimensions),
          };
        });
      }

      // Replace the previous version of this file.
      if (previous?.chunks) await writer.deleteDocs([docId]);
      await writer.add(
        file.rel,
        { ...base, chunks: docs.length, status: "ok" },
        docs,
      );
      if (previous) job.updated += 1;
      else job.added += 1;
      job.chunks += docs.length;
    } catch (error) {
      if (error instanceof FatalSyncError) throw error;
      if (stop.signal.aborted) return;
      const skipped = error instanceof SkipFile;
      const message = error instanceof Error ? error.message : String(error);
      if (previous?.chunks) await writer.deleteDocs([docId]);
      writer.note(file.rel, {
        ...base,
        chunks: 0,
        status: skipped ? "skipped" : "failed",
        message,
      });
      if (!skipped) {
        job.failed += 1;
        if (job.errors.length < MAX_ERRORS)
          job.errors.push({ path: file.rel, message });
      }
    } finally {
      job.processed += 1;
    }
  };

  // `stop` ends all workers on cancel or on the first fatal error.
  const stop = new AbortController();
  signal.addEventListener("abort", () => stop.abort(), { once: true });
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < pending.length && !stop.signal.aborted) {
      const file = pending[cursor++];
      try {
        await processFile(file);
      } catch (error) {
        stop.abort();
        throw error;
      }
    }
  });
  const results = await Promise.allSettled(workers);
  job.current = null;
  const fatal = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (fatal) {
    await writer.flush(); // keep what was processed before the failure
    throw fatal.reason;
  }

  // 4. Commit and wait for Meilisearch to finish indexing.
  job.phase = "commit";
  await writer.flush();
  if (writer.taskUids.length) {
    const last = writer.taskUids[writer.taskUids.length - 1];
    await client.tasks.waitForTask(last, { timeout: 0, interval: 500 });
    for (let start = 0; start < writer.taskUids.length; start += 100) {
      const { results } = await client.tasks.getTasks({
        uids: writer.taskUids.slice(start, start + 100),
      });
      for (const task of results) {
        if (task.status === "failed" && job.errors.length < MAX_ERRORS) {
          job.errors.push({
            path: `task #${task.uid}`,
            message: task.error?.message ?? "failed",
          });
        }
      }
    }
  }

  manifest.lastSync = {
    finishedAt: new Date().toISOString(),
    status: signal.aborted ? "canceled" : "done",
    files: Object.values(manifest.files).filter(
      (entry) => entry.status === "ok",
    ).length,
    chunks: Object.values(manifest.files).reduce(
      (total, entry) => total + entry.chunks,
      0,
    ),
    failed: Object.values(manifest.files).filter(
      (entry) => entry.status === "failed",
    ).length,
  };
  await writeManifest(config.id, manifest);
}
