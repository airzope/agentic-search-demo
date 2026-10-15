import "server-only";

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { currentEmbeddingModel } from "@/lib/embedding";
import { invalidateKb } from "@/lib/kb/catalog";
import { startSync } from "@/lib/kb/jobs";
import {
  getKbConfig,
  managedFilesDir,
  removeKbConfig,
  saveKbConfig,
} from "@/lib/kb/registry";
import { SCALE_PRESETS, buildKbSettings } from "@/lib/kb/schema";
import type { KbConfig, KbSource } from "@/lib/kb/types";
import { unwatchKb, watchKb } from "@/lib/kb/watch";
import {
  BadRequestError,
  getMeili,
  isHiddenIndex,
  isValidIndexUid,
  kbIdOf,
  settle,
} from "@/lib/meili";
import { BUILTIN_EMBEDDING } from "@/lib/providers";

export type CreateKbInput = {
  connectionId?: string;
  indexUid: string;
  name?: string;
  description?: string;
  locales?: string[];
  embedding?: boolean;
  dimensions?: number;
  scale?: "standard" | "large";
  chunkSize?: number;
  chunkOverlap?: number;
  source?:
    | {
        type: "directory";
        path: string;
        include?: string[];
        exclude?: string[];
        ocrImages?: boolean;
        ocrEmbedded?: boolean;
        watch?: boolean;
        maxFileSizeMb?: number;
      }
    | {
        type: "managed";
        ocrImages?: boolean;
        ocrEmbedded?: boolean;
        maxFileSizeMb?: number;
      };
};

const clamp = (
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) =>
  Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value!)))
    : fallback;

function normalizeSource(input: CreateKbInput["source"]): KbSource {
  if (input?.type === "directory") {
    const dir = input.path?.trim();
    if (!dir || !path.isAbsolute(dir)) {
      throw new BadRequestError(
        "Directory path must be absolute, e.g. /home/me/docs or D:\\Docs",
      );
    }
    return {
      type: "directory",
      path: path.resolve(dir),
      include: (input.include ?? [])
        .map((item) => item.trim().replace(/^\./, ""))
        .filter(Boolean),
      exclude: (input.exclude ?? []).map((item) => item.trim()).filter(Boolean),
      ocrImages: input.ocrImages ?? true,
      ocrEmbedded: input.ocrEmbedded ?? false,
      watch: input.watch ?? false,
      maxFileSizeMb: clamp(input.maxFileSizeMb, 1, 2048, 200),
    };
  }
  return {
    type: "managed",
    ocrImages: input?.ocrImages ?? true,
    ocrEmbedded: input?.ocrEmbedded ?? false,
    maxFileSizeMb: clamp(input?.maxFileSizeMb, 1, 2048, 200),
  };
}

export async function createKnowledgeBase(input: CreateKbInput) {
  const connectionId = input.connectionId || "local";
  const indexUid = input.indexUid?.trim() ?? "";
  if (!isValidIndexUid(indexUid) || isHiddenIndex(indexUid)) {
    throw new BadRequestError(
      "Index name may only contain letters, digits, - and _ (and must not start with __).",
    );
  }
  const source = normalizeSource(input.source);
  if (source.type === "directory") {
    const info = await stat(/*turbopackIgnore: true*/ source.path).catch(
      () => null,
    );
    if (!info?.isDirectory())
      throw new BadRequestError(`Directory not found: ${source.path}`);
  }

  const scale = input.scale === "large" ? "large" : "standard";
  const preset = SCALE_PRESETS[scale];
  const embeddingEnabled = input.embedding ?? true;
  const id = kbIdOf(connectionId, indexUid);
  const config: KbConfig = {
    id,
    connectionId,
    indexUid,
    name: input.name?.trim() || indexUid,
    description: input.description?.trim() ?? "",
    locales: (input.locales ?? []).filter(Boolean),
    embedding: {
      enabled: embeddingEnabled,
      dimensions: clamp(input.dimensions, 32, 4096, preset.dimensions),
      model: embeddingEnabled ? await currentEmbeddingModel() : null,
    },
    chunk: {
      size: clamp(input.chunkSize, 200, 4000, preset.chunkSize),
      overlap: clamp(input.chunkOverlap, 0, 1000, preset.overlap),
    },
    scale,
    source,
    createdAt: new Date().toISOString(),
  };
  if (
    config.embedding.enabled &&
    config.embedding.model === BUILTIN_EMBEDDING.id &&
    config.embedding.dimensions > BUILTIN_EMBEDDING.dimensions
  ) {
    config.embedding.dimensions = BUILTIN_EMBEDDING.dimensions;
  }

  const client = await getMeili(connectionId);
  await settle(client.createIndex(indexUid, { primaryKey: "id" }));
  await settle(client.index(indexUid).updateSettings(buildKbSettings(config)));
  await saveKbConfig(config);
  if (source.type === "managed")
    await mkdir(managedFilesDir(id), { recursive: true });
  invalidateKb(id);

  const job = source.type === "directory" ? startSync(id) : null;
  watchKb(config);
  return { config, job };
}

export type UpdateKbInput = {
  name?: string;
  description?: string;
  source?: Partial<{
    include: string[];
    exclude: string[];
    ocrImages: boolean;
    ocrEmbedded: boolean;
    watch: boolean;
    maxFileSizeMb: number;
  }>;
  /** Query/index languages; applied to the index right away. */
  locales?: string[];
  /** Chunking and vector changes re-index every file (a rebuild). */
  chunk?: Partial<{ size: number; overlap: number }>;
  embedding?: Partial<{ enabled: boolean; dimensions: number }>;
  scale?: "standard" | "large";
};

/**
 * Update a knowledge base. Returns the new config and whether a rebuild was
 * started because chunking, vectors or scale changed.
 */
export async function updateKnowledgeBase(id: string, input: UpdateKbInput) {
  const config = await getKbConfig(id);
  if (!config)
    throw new BadRequestError("This knowledge base has no app configuration");
  if (input.name !== undefined)
    config.name = input.name.trim() || config.indexUid;
  if (input.description !== undefined)
    config.description = input.description.trim();
  if (input.source) {
    const source = config.source;
    const patch = input.source;
    if (patch.ocrImages !== undefined) source.ocrImages = patch.ocrImages;
    if (patch.ocrEmbedded !== undefined) source.ocrEmbedded = patch.ocrEmbedded;
    if (patch.maxFileSizeMb !== undefined) {
      source.maxFileSizeMb = clamp(
        patch.maxFileSizeMb,
        1,
        2048,
        source.maxFileSizeMb,
      );
    }
    if (source.type === "directory") {
      if (patch.include) source.include = patch.include.filter(Boolean);
      if (patch.exclude) source.exclude = patch.exclude.filter(Boolean);
      if (patch.watch !== undefined) source.watch = patch.watch;
    }
  }
  let rebuild = false;
  if (input.chunk) {
    const size = clamp(input.chunk.size, 200, 4000, config.chunk.size);
    const overlap = clamp(input.chunk.overlap, 0, 1000, config.chunk.overlap);
    if (size !== config.chunk.size || overlap !== config.chunk.overlap) {
      config.chunk = { size, overlap };
      rebuild = true;
    }
  }
  if (input.embedding) {
    const enabled = input.embedding.enabled ?? config.embedding.enabled;
    let dimensions = clamp(
      input.embedding.dimensions,
      32,
      4096,
      config.embedding.dimensions,
    );
    if (config.embedding.model === BUILTIN_EMBEDDING.id) {
      dimensions = Math.min(dimensions, BUILTIN_EMBEDDING.dimensions);
    }
    if (
      enabled !== config.embedding.enabled ||
      (enabled && dimensions !== config.embedding.dimensions)
    ) {
      config.embedding = {
        enabled,
        dimensions,
        model: enabled ? await currentEmbeddingModel() : null,
      };
      rebuild = true;
    }
  }
  if (input.scale && input.scale !== config.scale) {
    config.scale = input.scale === "large" ? "large" : "standard";
    rebuild = true;
  }
  let localesChanged = false;
  if (input.locales) {
    const locales = input.locales.filter(Boolean);
    localesChanged = locales.join() !== config.locales.join();
    config.locales = locales;
  }

  await saveKbConfig(config);
  watchKb(config);
  if (rebuild) {
    startSync(id, { rebuild: true });
  } else if (localesChanged) {
    const client = await getMeili(config.connectionId);
    await settle(
      client.index(config.indexUid).updateSettings({
        localizedAttributes: buildKbSettings(config).localizedAttributes,
      }),
    );
  }
  invalidateKb(id);
  return { config, rebuild };
}

/** Delete a knowledge base: its index (unless kept), registration and managed files. */
export async function deleteKnowledgeBase(
  id: string,
  { keepIndex = false }: { keepIndex?: boolean } = {},
) {
  const [connectionId, indexUid] = [
    id.slice(0, id.indexOf(":")),
    id.slice(id.indexOf(":") + 1),
  ];
  unwatchKb(id);
  if (!keepIndex) {
    const client = await getMeili(connectionId);
    await settle(client.deleteIndex(indexUid));
  }
  await removeKbConfig(id, { purgeFiles: !keepIndex });
  invalidateKb(id);
}
