import "server-only";

import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
  Llama,
  LlamaEmbeddingContext,
  LlamaModel,
  Token,
} from "node-llama-cpp";

import { singleton } from "@/lib/global";
import { BUILTIN_EMBEDDING } from "@/lib/providers";
import { dataDir, getEmbeddingConfig } from "@/lib/settings";

/**
 * Qwen3-Embedding-0.6B running in-process through llama.cpp
 * (node-llama-cpp). Uses Metal/CUDA/Vulkan when available, CPU otherwise.
 */
export type BuiltinStatus = {
  state:
    "missing" | "downloading" | "downloaded" | "loading" | "ready" | "error";
  file: string;
  path: string;
  url: string;
  downloadedBytes: number;
  totalBytes: number | null;
  gpu: string | false | null;
  error: string | null;
};

type Runtime = {
  state: BuiltinStatus["state"] | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  gpu: string | false | null;
  llama: Llama | null;
  model: LlamaModel | null;
  context: LlamaEmbeddingContext | null;
  downloading: Promise<void> | null;
  loading: Promise<void> | null;
  /** Serializes embedding calls on the single context. */
  queue: Promise<unknown>;
};

const runtime = singleton<Runtime>("builtin-embedding", () => ({
  state: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  gpu: null,
  llama: null,
  model: null,
  context: null,
  downloading: null,
  loading: null,
  queue: Promise.resolve(),
}));

export const modelsDir = () => path.join(dataDir(), "models");
const modelPath = () => path.join(modelsDir(), BUILTIN_EMBEDDING.file);

const CONTEXT_SIZE = Number(process.env.EMBEDDING_CONTEXT_SIZE) || 2048;

async function fileSize(file: string) {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

export async function builtinStatus(): Promise<BuiltinStatus> {
  const { url } = await getEmbeddingConfig();
  const size = await fileSize(modelPath());
  const state = runtime.state ?? (size !== null ? "downloaded" : "missing");
  return {
    state,
    file: BUILTIN_EMBEDDING.file,
    path: modelPath(),
    url,
    downloadedBytes:
      state === "downloading" ? runtime.downloadedBytes : (size ?? 0),
    totalBytes: state === "downloading" ? runtime.totalBytes : size,
    gpu: runtime.gpu,
    error: runtime.error,
  };
}

/** Download the GGUF with resume support; validates the GGUF magic bytes. */
async function download(url: string) {
  await mkdir(modelsDir(), { recursive: true });
  const target = modelPath();
  const partial = `${target}.part`;
  let offset = (await fileSize(partial)) ?? 0;

  const response = await fetch(url, {
    headers: offset ? { Range: `bytes=${offset}-` } : {},
    redirect: "follow",
  });
  if (response.status === 416) {
    // The partial file is already complete.
  } else if (!response.ok || !response.body) {
    throw new Error(
      `Download failed (${response.status} ${response.statusText}) from ${url}. ` +
        "Try another source (hf-mirror / ModelScope) in Settings, or place the file manually.",
    );
  } else {
    if (offset && response.status !== 206) offset = 0; // range ignored
    const length = Number(response.headers.get("content-length")) || null;
    runtime.totalBytes = length !== null ? length + offset : null;
    runtime.downloadedBytes = offset;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        runtime.downloadedBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(counter) as never),
      createWriteStream(partial, { flags: offset ? "a" : "w" }),
    );
  }

  const handle = await open(partial, "r");
  const magic = Buffer.alloc(4);
  await handle.read(magic, 0, 4, 0);
  await handle.close();
  if (magic.toString("latin1") !== "GGUF") {
    await rm(partial, { force: true });
    throw new Error(`The downloaded file is not a GGUF model (${url}).`);
  }
  await rename(partial, target);
}

/** Make sure the model file exists, downloading it if needed. */
export async function ensureBuiltinDownloaded() {
  if ((await fileSize(modelPath())) !== null) return;
  if (!runtime.downloading) {
    runtime.state = "downloading";
    runtime.error = null;
    runtime.downloading = getEmbeddingConfig()
      .then(({ url }) => download(url))
      .then(
        () => {
          runtime.state = null;
        },
        (error: unknown) => {
          runtime.state = "error";
          runtime.error =
            error instanceof Error ? error.message : String(error);
          throw error;
        },
      )
      .finally(() => {
        runtime.downloading = null;
      });
  }
  await runtime.downloading;
}

/** Download (if needed) and load the model; idempotent. */
export async function ensureBuiltinLoaded() {
  if (runtime.context) return;
  await ensureBuiltinDownloaded();
  if (!runtime.loading) {
    runtime.state = "loading";
    runtime.error = null;
    runtime.loading = (async () => {
      const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
      const llama =
        runtime.llama ??
        (await getLlama({
          gpu: process.env.EMBEDDING_GPU === "false" ? false : "auto",
          logLevel: LlamaLogLevel.error,
        }));
      runtime.llama = llama;
      runtime.gpu = llama.gpu;
      const model = await llama.loadModel({ modelPath: modelPath() });
      const context = await model.createEmbeddingContext({
        contextSize: Math.min(CONTEXT_SIZE, model.trainContextSize),
      });
      runtime.model = model;
      runtime.context = context;
      runtime.state = "ready";
    })()
      .catch((error: unknown) => {
        runtime.state = "error";
        runtime.error = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => {
        runtime.loading = null;
      });
  }
  await runtime.loading;
}

/** Embed texts one by one on the shared context; returns raw vectors. */
export async function embedBuiltin(texts: string[]): Promise<number[][]> {
  await ensureBuiltinLoaded();
  const run = runtime.queue.then(async () => {
    const context = runtime.context!;
    const model = runtime.model!;
    // Leave room for the BOS/EOS tokens the context adds.
    const limit = Math.max(
      16,
      Math.min(CONTEXT_SIZE, model.trainContextSize) - 8,
    );
    const vectors: number[][] = [];
    for (const text of texts) {
      let tokens: Token[] = model.tokenize(text || " ");
      if (tokens.length > limit) tokens = tokens.slice(0, limit);
      const embedding = await context.getEmbeddingFor(tokens);
      vectors.push([...embedding.vector]);
    }
    return vectors;
  });
  runtime.queue = run.catch(() => undefined);
  return run;
}

export async function unloadBuiltin() {
  await runtime.context?.dispose();
  await runtime.model?.dispose();
  runtime.context = null;
  runtime.model = null;
  runtime.state = null;
}
