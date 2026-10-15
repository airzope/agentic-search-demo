import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_OCR_MODEL,
  OCR_MODELS,
  type OcrModelId,
  type OcrSource,
} from "@/lib/ocr/catalog";
import {
  BUILTIN_EMBEDDING,
  DEFAULT_QUERY_INSTRUCTION,
  PROVIDER_PRESETS,
  getPreset,
  type EmbeddingEngine,
  type ModelSource,
  type ProviderKind,
  type PublicConnection,
  type PublicProvider,
  type PublicSettings,
  type SettingsPatch,
} from "@/lib/providers";

/**
 * App settings saved from the UI. Values here override `.env`.
 * The file lives in `.data/` (git-ignored) and never leaves the server.
 */
type StoredProvider = {
  apiKey?: string;
  baseURL?: string;
  model?: string;
};

type StoredConnection = {
  id: string;
  name: string;
  host: string;
  apiKey?: string;
};

type StoredSettings = {
  meilisearch?: { host?: string; apiKey?: string };
  llm?: { active?: string; providers?: Record<string, StoredProvider> };
  connections?: StoredConnection[];
  embedding?: {
    engine?: EmbeddingEngine;
    source?: ModelSource;
    url?: string;
    baseURL?: string;
    apiKey?: string;
    model?: string;
    queryInstruction?: string;
  };
  ocr?: {
    enabled?: boolean;
    model?: OcrModelId;
    source?: OcrSource;
    baseUrl?: string;
    pypiIndex?: string;
  };
};

export type ResolvedProvider = {
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  apiKey?: string;
  model: string;
  configured: boolean;
};

const DEFAULT_MEILISEARCH_HOST = "http://127.0.0.1:7700";

export const dataDir = () =>
  process.env.APP_DATA_DIR ?? path.join(process.cwd(), ".data");
const settingsFile = () => path.join(dataDir(), "settings.json");

async function readStored(): Promise<StoredSettings> {
  try {
    return JSON.parse(await readFile(settingsFile(), "utf8")) as StoredSettings;
  } catch {
    return {};
  }
}

async function writeStored(settings: StoredSettings) {
  await mkdir(dataDir(), { recursive: true });
  const file = settingsFile();
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}

const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

function keyHint(key: string | undefined) {
  if (!key) return null;
  return key.length <= 8 ? "••••" : `••••${key.slice(-4)}`;
}

export async function getMeilisearchConfig() {
  const stored = (await readStored()).meilisearch ?? {};
  const envKey =
    env("MEILISEARCH_API_KEY") ??
    env("MEILISEARCH_MASTER_KEY") ??
    env("MEILISEARCH_SEARCH_API_KEY");
  return {
    host: stored.host ?? env("MEILISEARCH_HOST") ?? DEFAULT_MEILISEARCH_HOST,
    hostSource: stored.host
      ? ("settings" as const)
      : env("MEILISEARCH_HOST")
        ? ("env" as const)
        : ("default" as const),
    apiKey: stored.apiKey ?? envKey,
    keySource: stored.apiKey
      ? ("settings" as const)
      : envKey
        ? ("env" as const)
        : null,
  };
}

export const LOCAL_CONNECTION_ID = "local";
export const CONNECTION_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type ConnectionConfig = {
  id: string;
  name: string;
  host: string;
  apiKey?: string;
  builtin: boolean;
};

/** All Meilisearch instances: the local one first, then remote/cloud ones. */
export async function getConnections(): Promise<ConnectionConfig[]> {
  const stored = await readStored();
  const local = await getMeilisearchConfig();
  return [
    {
      id: LOCAL_CONNECTION_ID,
      name: "Local",
      host: local.host,
      apiKey: local.apiKey,
      builtin: true,
    },
    ...(stored.connections ?? []).map((connection) => ({
      ...connection,
      builtin: false,
    })),
  ];
}

export async function getEmbeddingConfig() {
  const stored = (await readStored()).embedding ?? {};
  const engine: EmbeddingEngine =
    stored.engine ??
    (env("EMBEDDING_ENGINE") === "remote" ? "remote" : "builtin");
  const source: ModelSource =
    stored.source ??
    ((env("EMBEDDING_MODEL_SOURCE") as ModelSource | undefined) ||
      (env("HF_ENDPOINT")?.includes("hf-mirror")
        ? "hf-mirror"
        : "huggingface"));
  const customUrl = stored.url ?? env("EMBEDDING_MODEL_URL");
  const url =
    source === "custom" && customUrl
      ? customUrl
      : BUILTIN_EMBEDDING.urls[source === "custom" ? "huggingface" : source];
  return {
    engine,
    source,
    url,
    customUrl,
    file: BUILTIN_EMBEDDING.file,
    remote: {
      baseURL: (stored.baseURL ?? env("EMBEDDING_BASE_URL") ?? "").replace(
        /\/+$/,
        "",
      ),
      apiKey: stored.apiKey ?? env("EMBEDDING_API_KEY"),
      model: stored.model ?? env("EMBEDDING_MODEL") ?? "",
    },
    queryInstruction:
      stored.queryInstruction ??
      env("EMBEDDING_QUERY_INSTRUCTION") ??
      DEFAULT_QUERY_INSTRUCTION,
  };
}

const OCR_MODEL_IDS = OCR_MODELS.map((model) => model.id);

export async function getOcrConfig() {
  const stored = (await readStored()).ocr ?? {};
  const envModel = env("OCR_MODEL") as OcrModelId | undefined;
  const model: OcrModelId =
    stored.model && OCR_MODEL_IDS.includes(stored.model)
      ? stored.model
      : envModel && OCR_MODEL_IDS.includes(envModel)
        ? envModel
        : DEFAULT_OCR_MODEL;
  return {
    enabled: stored.enabled ?? env("OCR_ENABLED") !== "false",
    model,
    source:
      stored.source ??
      (env("OCR_MODEL_SOURCE") as OcrSource | undefined) ??
      ("auto" as OcrSource),
    baseUrl: (stored.baseUrl ?? env("OCR_MODEL_BASE_URL") ?? "").replace(
      /\/+$/,
      "",
    ),
    pypiIndex: (
      stored.pypiIndex ??
      env("PIP_INDEX_URL") ??
      "https://pypi.org/simple"
    ).replace(/\/+$/, ""),
  };
}

function resolveFrom(
  id: string,
  stored: StoredSettings,
): (ResolvedProvider & { keySource: PublicProvider["keySource"] }) | null {
  const preset = getPreset(id);
  if (!preset) return null;
  const saved = stored.llm?.providers?.[id] ?? {};
  const envKey = [
    preset.envPrefix + "_API_KEY",
    ...(preset.keyEnvAliases ?? []),
  ]
    .map(env)
    .find(Boolean);
  const apiKey = saved.apiKey ?? envKey;
  const baseURL =
    saved.baseURL ?? env(`${preset.envPrefix}_BASE_URL`) ?? preset.baseURL;
  const model = saved.model ?? env(`${preset.envPrefix}_MODEL`) ?? preset.model;
  const touched = Boolean(
    stored.llm?.providers?.[id] ||
    envKey ||
    env(`${preset.envPrefix}_BASE_URL`) ||
    env(`${preset.envPrefix}_MODEL`),
  );
  const configured =
    Boolean(baseURL && model) &&
    (preset.keyRequired ? Boolean(apiKey) : touched);

  return {
    id,
    kind: preset.kind,
    name: preset.name,
    baseURL,
    apiKey,
    model,
    configured,
    keySource: saved.apiKey ? "settings" : envKey ? "env" : null,
  };
}

export async function resolveProvider(id: string) {
  return resolveFrom(id, await readStored());
}

/** The provider used when the client does not pick one. */
export async function resolveActiveProviderId() {
  const stored = await readStored();
  const preferred = stored.llm?.active ?? env("LLM_PROVIDER");
  if (preferred && resolveFrom(preferred, stored)?.configured) return preferred;
  return (
    PROVIDER_PRESETS.find(
      (preset) => resolveFrom(preset.id, stored)?.configured,
    )?.id ?? null
  );
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const stored = await readStored();
  const meili = await getMeilisearchConfig();
  const providers = PROVIDER_PRESETS.map((preset): PublicProvider => {
    const resolved = resolveFrom(preset.id, stored)!;
    return {
      id: preset.id,
      kind: preset.kind,
      name: preset.name,
      group: preset.group,
      baseURL: resolved.baseURL,
      defaultBaseURL: preset.baseURL,
      model: resolved.model,
      defaultModel: preset.model,
      keyRequired: preset.keyRequired,
      keyUrl: preset.keyUrl,
      hasKey: Boolean(resolved.apiKey),
      keySource: resolved.keySource,
      keyHint: keyHint(resolved.apiKey),
      configured: resolved.configured,
    };
  });

  const embedding = await getEmbeddingConfig();
  const connections = (await getConnections()).map(
    (connection): PublicConnection => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      hasKey: Boolean(connection.apiKey),
      keyHint: keyHint(connection.apiKey),
      builtin: connection.builtin,
    }),
  );

  return {
    connections,
    embedding: {
      engine: embedding.engine,
      builtin: {
        model: BUILTIN_EMBEDDING.id,
        file: embedding.file,
        source: embedding.source,
        url: embedding.url,
      },
      remote: {
        baseURL: embedding.remote.baseURL,
        model: embedding.remote.model,
        hasKey: Boolean(embedding.remote.apiKey),
        keyHint: keyHint(embedding.remote.apiKey),
      },
      queryInstruction: embedding.queryInstruction,
    },
    ocr: await getOcrConfig(),
    meilisearch: {
      host: meili.host,
      hostSource: meili.hostSource,
      hasKey: Boolean(meili.apiKey),
      keySource: meili.keySource,
      keyHint: keyHint(meili.apiKey),
    },
    llm: { active: await resolveActiveProviderId(), providers },
  };
}

function applyField<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null | undefined,
) {
  if (value === undefined) return;
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    delete target[key];
  } else {
    target[key] = (typeof value === "string" ? value.trim() : value) as T[K];
  }
}

export async function updateSettings(patch: SettingsPatch) {
  const stored = await readStored();

  if (patch.meilisearch) {
    const meili = (stored.meilisearch ??= {});
    applyField(meili, "host", patch.meilisearch.host?.replace(/\/+$/, ""));
    applyField(meili, "apiKey", patch.meilisearch.apiKey);
  }

  if (patch.llm) {
    const llm = (stored.llm ??= {});
    if (patch.llm.active !== undefined) {
      if (patch.llm.active && !getPreset(patch.llm.active)) {
        throw new Error(`Unknown provider: ${patch.llm.active}`);
      }
      applyField(llm, "active", patch.llm.active);
    }
    for (const [id, value] of Object.entries(patch.llm.providers ?? {})) {
      if (!getPreset(id)) throw new Error(`Unknown provider: ${id}`);
      const providers = (llm.providers ??= {});
      if (value === null) {
        delete providers[id];
        continue;
      }
      const entry = (providers[id] ??= {});
      applyField(entry, "apiKey", value.apiKey);
      applyField(entry, "baseURL", value.baseURL?.replace(/\/+$/, ""));
      applyField(entry, "model", value.model);
    }
  }

  if (patch.connections) {
    const list = (stored.connections ??= []);
    for (const id of patch.connections.remove ?? []) {
      const at = list.findIndex((connection) => connection.id === id);
      if (at >= 0) list.splice(at, 1);
    }
    for (const item of patch.connections.upsert ?? []) {
      if (!CONNECTION_ID.test(item.id) || item.id === LOCAL_CONNECTION_ID) {
        throw new Error(
          `Invalid connection id "${item.id}": use lowercase letters, digits, - and _.`,
        );
      }
      let entry = list.find((connection) => connection.id === item.id);
      if (!entry) {
        if (!item.host) throw new Error("Connection host is required");
        entry = { id: item.id, name: item.name || item.id, host: item.host };
        list.push(entry);
      }
      if (item.name) entry.name = item.name.trim();
      if (item.host) entry.host = item.host.trim().replace(/\/+$/, "");
      applyField(entry, "apiKey", item.apiKey);
    }
  }

  if (patch.embedding) {
    const embedding = (stored.embedding ??= {});
    applyField(embedding, "engine", patch.embedding.engine);
    applyField(embedding, "source", patch.embedding.source);
    applyField(embedding, "url", patch.embedding.url);
    applyField(embedding, "baseURL", patch.embedding.baseURL);
    applyField(embedding, "apiKey", patch.embedding.apiKey);
    applyField(embedding, "model", patch.embedding.model);
    applyField(embedding, "queryInstruction", patch.embedding.queryInstruction);
  }

  if (patch.ocr) {
    const ocr = (stored.ocr ??= {});
    if (patch.ocr.enabled !== undefined) ocr.enabled = patch.ocr.enabled;
    if (patch.ocr.model && OCR_MODEL_IDS.includes(patch.ocr.model)) {
      ocr.model = patch.ocr.model;
    }
    applyField(ocr, "source", patch.ocr.source);
    applyField(ocr, "baseUrl", patch.ocr.baseUrl?.replace(/\/+$/, ""));
    applyField(ocr, "pypiIndex", patch.ocr.pypiIndex?.replace(/\/+$/, ""));
  }

  await writeStored(stored);
  return getPublicSettings();
}
