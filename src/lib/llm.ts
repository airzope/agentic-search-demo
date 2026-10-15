import "server-only";

import {
  resolveActiveProviderId,
  resolveProvider,
  type ResolvedProvider,
} from "@/lib/settings";

export class LlmConfigError extends Error {}

/** Resolve the provider for a request; falls back to the active provider. */
export async function getProvider(providerId?: string | null) {
  const id = providerId || (await resolveActiveProviderId());
  if (!id) {
    throw new LlmConfigError(
      "No LLM provider is configured. Add an API key in Settings.",
    );
  }
  const provider = await resolveProvider(id);
  if (!provider) throw new LlmConfigError(`Unknown provider: ${id}`);
  if (!provider.baseURL) {
    throw new LlmConfigError(`${provider.name}: base URL is missing.`);
  }
  return provider;
}

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      message = body?.error?.message ?? body?.message ?? message;
    } catch {
      // keep raw text
    }
    throw new Error(`${response.status} ${message}`.trim());
  }
  return JSON.parse(text) as unknown;
}

/** List models from the provider's own catalog endpoint. */
export async function listModels(provider: ResolvedProvider) {
  const base = provider.baseURL.replace(/\/+$/, "");
  let ids: string[] = [];

  if (provider.kind === "anthropic") {
    const body = (await fetchJson(`${base}/models?limit=100`, {
      headers: {
        "x-api-key": provider.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
    })) as { data?: { id: string }[] };
    ids = (body.data ?? []).map((model) => model.id);
  } else if (provider.kind === "google") {
    const body = (await fetchJson(`${base}/models?pageSize=200`, {
      headers: { "x-goog-api-key": provider.apiKey ?? "" },
    })) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    };
    ids = (body.models ?? [])
      .filter((model) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((model) => model.name.replace(/^models\//, ""));
  } else {
    const body = (await fetchJson(`${base}/models`, {
      headers: provider.apiKey
        ? { Authorization: `Bearer ${provider.apiKey}` }
        : {},
    })) as { data?: { id: string }[] };
    ids = (body.data ?? []).map((model) => model.id);
  }

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
