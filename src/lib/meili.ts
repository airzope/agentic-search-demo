import "server-only";

import {
  Meilisearch,
  MeilisearchApiError,
  MeilisearchRequestError,
  type EnqueuedTaskPromise,
  type Settings,
  type Task,
} from "meilisearch";

import {
  LOCAL_CONNECTION_ID,
  getConnections,
  type ConnectionConfig,
} from "@/lib/settings";

/** Indexes whose uid starts with this prefix are internal and hidden. */
export const HIDDEN_INDEX_PREFIX = "__";

export const isHiddenIndex = (uid: string) =>
  uid.startsWith(HIDDEN_INDEX_PREFIX);

const clients = new Map<string, Meilisearch>();

function clientFor(connection: ConnectionConfig) {
  const key = `${connection.host}\u0000${connection.apiKey ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    client = new Meilisearch({
      host: connection.host,
      apiKey: connection.apiKey,
      timeout: 60_000,
    });
    clients.set(key, client);
  }
  return client;
}

export async function getConnection(connectionId: string) {
  const connection = (await getConnections()).find(
    (item) => item.id === connectionId,
  );
  if (!connection)
    throw new BadRequestError(`Unknown connection: ${connectionId}`);
  return connection;
}

/** Meilisearch client for a connection (defaults to the local instance). */
export async function getMeili(connectionId: string = LOCAL_CONNECTION_ID) {
  return clientFor(await getConnection(connectionId));
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

/** Knowledge-base ids are `<connection>:<index uid>`; a bare uid means local. */
export function parseKbId(id: unknown) {
  if (typeof id !== "string")
    throw new BadRequestError("Invalid knowledge base id");
  const at = id.indexOf(":");
  const connectionId = at >= 0 ? id.slice(0, at) : LOCAL_CONNECTION_ID;
  const indexUid = at >= 0 ? id.slice(at + 1) : id;
  if (
    !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(connectionId) ||
    !isValidIndexUid(indexUid)
  ) {
    throw new BadRequestError("Invalid knowledge base id");
  }
  return { id: `${connectionId}:${indexUid}`, connectionId, indexUid };
}

export const kbIdOf = (connectionId: string, indexUid: string) =>
  `${connectionId}:${indexUid}`;

/** KB id from a dynamic route segment (`local:docs` may arrive URL-encoded). */
export async function kbIdParam(params: Promise<{ id: string }>) {
  const raw = (await params).id;
  return parseKbId(raw.includes("%") ? decodeURIComponent(raw) : raw).id;
}

/** Resolve a KB id to its Meilisearch index handle. */
export async function getKbIndex(id: unknown) {
  const ref = parseKbId(id);
  const client = await getMeili(ref.connectionId);
  return { ...ref, client, index: client.index(ref.indexUid) };
}

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
