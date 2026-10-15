import "server-only";

import {
  Meilisearch,
  MeilisearchApiError,
  MeilisearchRequestError,
  type EnqueuedTaskPromise,
  type Settings,
  type Task,
} from "meilisearch";

import { getMeilisearchConfig } from "@/lib/settings";

/** Indexes whose uid starts with this prefix are internal and hidden. */
export const HIDDEN_INDEX_PREFIX = "__";

export const isHiddenIndex = (uid: string) =>
  uid.startsWith(HIDDEN_INDEX_PREFIX);

let cached: { key: string; client: Meilisearch } | null = null;

export async function getMeili() {
  const { host, apiKey } = await getMeilisearchConfig();
  const key = `${host}\u0000${apiKey ?? ""}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new Meilisearch({ host, apiKey, timeout: 30_000 }),
    };
  }
  return cached.client;
}

/** Wait for a task and throw its error message if it failed. */
export async function settle(task: EnqueuedTaskPromise, timeout = 60_000) {
  const done: Task = await task.waitTask({ timeout, interval: 50 });
  if (done.status === "failed") {
    throw new Error(done.error?.message ?? "Meilisearch task failed");
  }
  return done;
}

export type ErrorBody = { error: string; code?: string };

/** Map any thrown value to a JSON error response. */
export function errorResponse(error: unknown) {
  if (error instanceof BadRequestError) {
    return Response.json({ error: error.message } satisfies ErrorBody, {
      status: 400,
    });
  }
  if (error instanceof MeilisearchApiError) {
    return Response.json(
      {
        error: error.cause?.message ?? error.message,
        code: error.cause?.code,
      } satisfies ErrorBody,
      { status: error.response.status || 500 },
    );
  }
  if (error instanceof MeilisearchRequestError) {
    return Response.json(
      {
        error: `Cannot reach Meilisearch: ${error.message}`,
        code: "meilisearch_unreachable",
      } satisfies ErrorBody,
      { status: 502 },
    );
  }
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  return Response.json({ error: message } satisfies ErrorBody, {
    status: 500,
  });
}

/** Wrap a route handler body so errors become JSON responses. */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    console.error("[api]", error);
    return errorResponse(error);
  }
}

export function badRequest(message: string) {
  return Response.json({ error: message } satisfies ErrorBody, {
    status: 400,
  });
}

export const isValidIndexUid = (uid: string) =>
  /^[A-Za-z0-9_-]{1,400}$/.test(uid);

/** Thrown for invalid client input; mapped to HTTP 400. */
export class BadRequestError extends Error {}

/** Index uids end up in Meilisearch URL paths, so only allow valid ones. */
export function assertIndexUid(uid: unknown) {
  if (typeof uid !== "string" || !isValidIndexUid(uid)) {
    throw new BadRequestError("Invalid index uid");
  }
  return uid;
}

/** Settings keys exposed for editing in the UI. */
export const EDITABLE_SETTINGS = [
  "searchableAttributes",
  "displayedAttributes",
  "filterableAttributes",
  "sortableAttributes",
  "rankingRules",
  "stopWords",
  "synonyms",
  "distinctAttribute",
  "typoTolerance",
  "faceting",
  "pagination",
  "separatorTokens",
  "nonSeparatorTokens",
  "dictionary",
  "proximityPrecision",
  "embedders",
  "searchCutoffMs",
  "localizedAttributes",
  "facetSearch",
  "prefixSearch",
] as const satisfies readonly (keyof Settings)[];
