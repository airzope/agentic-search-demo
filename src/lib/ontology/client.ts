import "server-only";

import {
  PalantirApiError,
  createClient,
  createPlatformClient,
  type Client,
} from "@osdk/client";
import { OntologiesV2 } from "@osdk/foundry.ontologies";
import { createConfidentialOauthClient } from "@osdk/oauth";

import { singleton } from "@/lib/global";
import type { OntologyConnection } from "@/lib/ontology/store";
import type { OntologyInfo } from "@/lib/ontology/types";

/** An OSDK client bound to one connection and its resolved ontology. */
export type OsdkSession = {
  client: Client;
  ontology: OntologyInfo;
  connection: OntologyConnection;
};

const sessions = singleton(
  "osdk-sessions",
  () => new Map<string, { key: string; session: Promise<OsdkSession> }>(),
);

const REQUEST_TIMEOUT_MS = 45_000;

/** Foundry calls time out instead of hanging a chat turn. */
const timedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

function tokenProvider(connection: OntologyConnection) {
  if (connection.auth === "oauth") {
    return createConfidentialOauthClient(
      connection.clientId!,
      connection.clientSecret!,
      connection.baseUrl,
      connection.scopes?.length ? connection.scopes : undefined,
      timedFetch,
    );
  }
  const token = connection.token ?? "";
  return async () => token;
}

const sessionKey = (connection: OntologyConnection) =>
  JSON.stringify([
    connection.baseUrl,
    connection.ontology,
    connection.auth,
    connection.token,
    connection.clientId,
    connection.clientSecret,
    connection.scopes,
  ]);

async function open(connection: OntologyConnection): Promise<OsdkSession> {
  const auth = tokenProvider(connection);
  const platform = createPlatformClient(
    connection.baseUrl,
    auth,
    undefined,
    timedFetch,
  );
  // Accepts an RID or an API name; createClient needs the RID.
  const info = await OntologiesV2.get(platform, connection.ontology);
  const client = createClient(
    connection.baseUrl,
    info.rid,
    auth,
    undefined,
    timedFetch,
  );
  return {
    client,
    connection,
    ontology: {
      apiName: info.apiName,
      displayName: info.displayName,
      description: info.description || undefined,
      rid: info.rid,
    },
  };
}

/**
 * The OSDK session for a connection, reused while its settings are unchanged.
 * Failed sessions are dropped so the next call retries.
 */
export function osdkSession(connection: OntologyConnection) {
  const key = sessionKey(connection);
  const cached = sessions.get(connection.id);
  if (cached?.key === key) return cached.session;
  const session = open(connection);
  sessions.set(connection.id, { key, session });
  session.catch(() => {
    if (sessions.get(connection.id)?.session === session) {
      sessions.delete(connection.id);
    }
  });
  return session;
}

/** Open a session for unsaved settings (connection test). */
export const testSession = (connection: OntologyConnection) => open(connection);

export function closeOsdkSession(id: string) {
  sessions.delete(id);
}

/** List the ontologies the credentials can see (to help pick one). */
export async function listOntologies(connection: OntologyConnection) {
  const platform = createPlatformClient(
    connection.baseUrl,
    tokenProvider(connection),
    undefined,
    timedFetch,
  );
  const result = await OntologiesV2.list(platform);
  return result.data.map((item): OntologyInfo => ({
    apiName: item.apiName,
    displayName: item.displayName,
    description: item.description || undefined,
    rid: item.rid,
  }));
}

/** Readable message for OSDK / Foundry errors. */
export function foundryErrorMessage(error: unknown) {
  if (error instanceof PalantirApiError) {
    const name = error.errorName ? `${error.errorName}: ` : "";
    const status = error.statusCode ? ` (HTTP ${error.statusCode})` : "";
    const params =
      error.parameters && Object.keys(error.parameters).length
        ? ` ${JSON.stringify(error.parameters).slice(0, 300)}`
        : "";
    return `${name}${error.message || "Foundry request failed"}${status}${params}`;
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      return "Foundry did not respond in time.";
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    if (cause?.code) return `${error.message} (${cause.code})`;
    return error.message;
  }
  return String(error);
}
