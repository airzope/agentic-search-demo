import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  PROVIDER_PRESETS,
  getPreset,
  type ProviderKind,
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

type StoredSettings = {
  meilisearch?: { host?: string; apiKey?: string };
  llm?: { active?: string; providers?: Record<string, StoredProvider> };
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

const dataDir = () =>
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

  return {
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

  await writeStored(stored);
  return getPublicSettings();
}
