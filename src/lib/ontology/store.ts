import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { singleton } from "@/lib/global";
import { BadRequestError } from "@/lib/meili";
import type {
  OntologyAuthType,
  OntologyInput,
  PublicOntology,
} from "@/lib/ontology/types";
import { dataDir } from "@/lib/settings";

/**
 * Ontology connections, stored in `.data/ontologies.json` (mode 600: it holds
 * Foundry tokens and OAuth secrets that never leave the server). A connection
 * configured with FOUNDRY_* variables is added as the read-only `foundry`.
 */
export type OntologyConnection = {
  id: string;
  name: string;
  description?: string;
  baseUrl: string;
  ontology: string;
  auth: OntologyAuthType;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  objectTypes?: string[];
  allowActions?: boolean;
  allowFunctions?: boolean;
  createdAt?: string;
  updatedAt?: string;
  source: "settings" | "env";
};

type StoredFile = {
  version: 1;
  connections: Omit<OntologyConnection, "source">[];
};

export const ONTOLOGY_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const ENV_ONTOLOGY_ID = "foundry";

const storeFile = () => path.join(dataDir(), "ontologies.json");

async function read(): Promise<StoredFile> {
  try {
    const data = JSON.parse(await readFile(storeFile(), "utf8"));
    return { version: 1, connections: data.connections ?? [] };
  } catch {
    return { version: 1, connections: [] };
  }
}

const lock = singleton("ontology-store-lock", () => ({
  chain: Promise.resolve() as Promise<unknown>,
}));

async function mutate<T>(fn: (data: StoredFile) => T | Promise<T>) {
  const run = lock.chain.then(async () => {
    const data = await read();
    const result = await fn(data);
    await mkdir(dataDir(), { recursive: true });
    const file = storeFile();
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, file);
    return result;
  });
  lock.chain = run.catch(() => undefined);
  return run;
}

const env = (name: string) => process.env[name]?.trim() || undefined;

/** `https://stack.example.com/api/` → `https://stack.example.com` */
export function normalizeBaseUrl(value: string) {
  const trimmed = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestError(`Invalid Foundry URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BadRequestError("The Foundry URL must start with https://");
  }
  return trimmed;
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

function envConnection(): OntologyConnection | null {
  const baseUrl = env("FOUNDRY_URL");
  const ontology = env("FOUNDRY_ONTOLOGY");
  if (!baseUrl || !ontology) return null;
  const clientId = env("FOUNDRY_CLIENT_ID");
  const clientSecret = env("FOUNDRY_CLIENT_SECRET");
  return {
    id: ENV_ONTOLOGY_ID,
    name: env("FOUNDRY_NAME") ?? "Foundry",
    baseUrl: baseUrl.replace(/\/+$/, "").replace(/\/api$/, ""),
    ontology,
    auth: clientId && clientSecret && !env("FOUNDRY_TOKEN") ? "oauth" : "token",
    token: env("FOUNDRY_TOKEN"),
    clientId,
    clientSecret,
    scopes: list(env("FOUNDRY_SCOPES")),
    objectTypes: list(env("FOUNDRY_OBJECT_TYPES")),
    allowActions: env("FOUNDRY_ALLOW_ACTIONS") === "true",
    allowFunctions: env("FOUNDRY_ALLOW_FUNCTIONS") !== "false",
    source: "env",
  };
}

export async function listOntologyConnections(): Promise<OntologyConnection[]> {
  const stored = (await read()).connections.map(
    (connection): OntologyConnection => ({ ...connection, source: "settings" }),
  );
  const fromEnv = envConnection();
  return fromEnv && !stored.some((item) => item.id === fromEnv.id)
    ? [fromEnv, ...stored]
    : stored;
}

export async function getOntologyConnection(id: string) {
  return (
    (await listOntologyConnections()).find(
      (connection) => connection.id === id,
    ) ?? null
  );
}

export async function requireOntologyConnection(id: string) {
  const connection = await getOntologyConnection(id);
  if (!connection) throw new BadRequestError(`Unknown ontology: ${id}`);
  return connection;
}

function hint(secret: string | undefined) {
  if (!secret) return null;
  return secret.length <= 8 ? "••••" : `••••${secret.slice(-4)}`;
}

export function toPublicOntology(
  connection: OntologyConnection,
): PublicOntology {
  return {
    id: connection.id,
    name: connection.name,
    description: connection.description,
    baseUrl: connection.baseUrl,
    ontology: connection.ontology,
    auth: connection.auth,
    tokenHint: hint(
      connection.auth === "oauth" ? connection.clientSecret : connection.token,
    ),
    clientId: connection.clientId,
    scopes: connection.scopes?.length ? connection.scopes : undefined,
    objectTypes: connection.objectTypes ?? [],
    allowActions: Boolean(connection.allowActions),
    allowFunctions: connection.allowFunctions !== false,
    source: connection.source,
  };
}

const clean = (value: string | undefined) => value?.trim() || undefined;

/**
 * Merge user input over an existing connection (if any) without saving it:
 * also used to test settings before they are saved.
 */
export function mergeOntologyInput(
  input: OntologyInput,
  existing: OntologyConnection | null,
): OntologyConnection {
  const id = input.id?.trim();
  if (!id || !ONTOLOGY_ID.test(id)) {
    throw new BadRequestError(
      `Invalid id "${input.id ?? ""}": use lowercase letters, digits, - and _.`,
    );
  }
  const ontology = clean(input.ontology);
  if (!ontology) {
    throw new BadRequestError("Enter the ontology RID or API name.");
  }
  const auth: OntologyAuthType = input.auth === "oauth" ? "oauth" : "token";
  const merged: OntologyConnection = {
    ...(existing ?? {}),
    id,
    name: clean(input.name) ?? existing?.name ?? id,
    description: clean(input.description),
    baseUrl: normalizeBaseUrl(input.baseUrl ?? ""),
    ontology,
    auth,
    token: clean(input.token) ?? existing?.token,
    clientId: clean(input.clientId) ?? existing?.clientId,
    clientSecret: clean(input.clientSecret) ?? existing?.clientSecret,
    scopes: input.scopes
      ? input.scopes.map((scope) => scope.trim()).filter(Boolean)
      : existing?.scopes,
    objectTypes: input.objectTypes
      ? [...new Set(input.objectTypes.map((item) => item.trim()))].filter(
          Boolean,
        )
      : existing?.objectTypes,
    allowActions: input.allowActions ?? existing?.allowActions ?? false,
    allowFunctions: input.allowFunctions ?? existing?.allowFunctions ?? true,
    source: existing?.source ?? "settings",
  };
  if (auth === "token" && !merged.token) {
    throw new BadRequestError("Enter a Foundry token.");
  }
  if (auth === "oauth" && (!merged.clientId || !merged.clientSecret)) {
    throw new BadRequestError("Enter the OAuth client ID and client secret.");
  }
  return merged;
}

export async function saveOntologyConnection(input: OntologyInput) {
  if (input.id === ENV_ONTOLOGY_ID && envConnection()) {
    throw new BadRequestError(
      "This connection is configured with FOUNDRY_* environment variables.",
    );
  }
  return mutate((data) => {
    const index = data.connections.findIndex((item) => item.id === input.id);
    const existing =
      index >= 0
        ? ({ ...data.connections[index], source: "settings" } as const)
        : null;
    const { source: _source, ...merged } = mergeOntologyInput(input, existing);
    void _source;
    const now = new Date().toISOString();
    const saved = {
      ...merged,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (index >= 0) data.connections[index] = saved;
    else data.connections.push(saved);
    return { ...saved, source: "settings" } as OntologyConnection;
  });
}

export async function deleteOntologyConnection(id: string) {
  return mutate((data) => {
    const before = data.connections.length;
    data.connections = data.connections.filter((item) => item.id !== id);
    if (data.connections.length === before) {
      throw new BadRequestError(
        id === ENV_ONTOLOGY_ID
          ? "Remove the FOUNDRY_* environment variables to delete this connection."
          : `Unknown ontology: ${id}`,
      );
    }
  });
}
