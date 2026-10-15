import "server-only";

import { embedBuiltin } from "@/lib/embedding/builtin";
import { singleton } from "@/lib/global";
import { BUILTIN_EMBEDDING } from "@/lib/providers";
import { getEmbeddingConfig } from "@/lib/settings";

/**
 * Embedding entry point used by ingestion and search. Documents are embedded
 * as-is; queries get the Qwen3 instruction prefix (asymmetric retrieval).
 */

const REMOTE_BATCH = Number(process.env.EMBEDDING_BATCH_SIZE) || 10;

export function normalize(vector: number[]) {
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

/** Matryoshka truncation: keep the first `dimensions` values, renormalize. */
export function truncate(vector: number[], dimensions: number) {
  return vector.length <= dimensions
    ? vector
    : normalize(vector.slice(0, dimensions));
}

/**
 * Identity of the vector space. Builtin and remote Qwen3-Embedding-0.6B
 * (e.g. Ollama `qwen3-embedding:0.6b`) share one space.
 */
export function modelIdFor(engine: "builtin" | "remote", remoteModel: string) {
  if (engine === "builtin") return BUILTIN_EMBEDDING.id;
  const name = remoteModel.toLowerCase();
  if (name.includes("qwen3-embedding") && /0[._]6b/.test(name)) {
    return BUILTIN_EMBEDDING.id;
  }
  return `remote:${remoteModel}`;
}

export async function currentEmbeddingModel() {
  const config = await getEmbeddingConfig();
  return modelIdFor(config.engine, config.remote.model);
}

async function embedRemote(texts: string[]) {
  const config = await getEmbeddingConfig();
  const { baseURL, apiKey, model } = config.remote;
  if (!baseURL || !model) {
    throw new Error(
      "Remote embedding service is not configured (Settings → Embedding).",
    );
  }
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += REMOTE_BATCH) {
    const batch = texts.slice(start, start + REMOTE_BATCH);
    const response = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: batch, encoding_format: "float" }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Embedding service ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    const body = JSON.parse(text) as {
      data?: { index: number; embedding: number[] }[];
    };
    const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== batch.length) {
      throw new Error(
        "Embedding service returned an unexpected number of vectors",
      );
    }
    vectors.push(...data.map((item) => item.embedding));
  }
  return vectors;
}

async function embedRaw(texts: string[]) {
  const config = await getEmbeddingConfig();
  const vectors =
    config.engine === "remote"
      ? await embedRemote(texts)
      : await embedBuiltin(texts);
  return vectors.map(normalize);
}

/** Embed document chunks (no instruction), full dimensionality. */
export async function embedDocuments(texts: string[]) {
  if (!texts.length) return [];
  return embedRaw(texts);
}

const queryCache = singleton(
  "query-embedding-cache",
  () => new Map<string, number[]>(),
);

/** Embed a search query with the Qwen3 retrieval instruction; cached. */
export async function embedQuery(query: string) {
  const config = await getEmbeddingConfig();
  const instruction = config.queryInstruction.trim();
  const input = instruction
    ? `Instruct: ${instruction}\nQuery:${query}`
    : query;
  const key = `${modelIdFor(config.engine, config.remote.model)}\u0000${input}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  const [vector] = await embedRaw([input]);
  queryCache.set(key, vector);
  if (queryCache.size > 500) {
    queryCache.delete(queryCache.keys().next().value as string);
  }
  return vector;
}
