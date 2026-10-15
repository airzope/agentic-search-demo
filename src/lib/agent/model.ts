import "server-only";

import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type ProviderStreams,
} from "@earendil-works/pi-ai";

import type { ResolvedProvider } from "@/lib/settings";

/**
 * Bridge the app's LLM settings to pi-ai: one pi `Model` plus a stream
 * function whose auth comes from the app settings (never from env lookups
 * inside pi), so every configured vendor works through the pi agent loop.
 */
const API_OF: Record<ResolvedProvider["kind"], Api> = {
  openai: "openai-responses",
  anthropic: "anthropic-messages",
  google: "google-generative-ai",
  "openai-compatible": "openai-completions",
};

/** App provider id → pi catalog provider, for context window / reasoning metadata. */
const CATALOG: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  openrouter: "openrouter",
  deepseek: "deepseek",
  kimi: "moonshotai-cn",
};

/** Compatibility for OpenAI-compatible vendors pi does not auto-detect. */
const COMPAT: Record<string, Record<string, unknown>> = {
  qwen: {
    supportsDeveloperRole: false,
    supportsStore: false,
    thinkingFormat: "qwen",
  },
  zhipu: {
    supportsDeveloperRole: false,
    supportsStore: false,
    thinkingFormat: "zai",
  },
  doubao: { supportsDeveloperRole: false, supportsStore: false },
  siliconflow: { supportsDeveloperRole: false, supportsStore: false },
  ollama: {
    supportsDeveloperRole: false,
    supportsStore: false,
    supportsReasoningEffort: false,
  },
  custom: {
    supportsDeveloperRole: false,
    supportsStore: false,
    supportsReasoningEffort: false,
  },
};

async function loadApi(api: Api): Promise<ProviderStreams> {
  switch (api) {
    case "anthropic-messages":
      return (
        await import("@earendil-works/pi-ai/api/anthropic-messages.lazy")
      ).anthropicMessagesApi();
    case "google-generative-ai":
      return (
        await import("@earendil-works/pi-ai/api/google-generative-ai.lazy")
      ).googleGenerativeAIApi();
    case "openai-responses":
      return (
        await import("@earendil-works/pi-ai/api/openai-responses.lazy")
      ).openAIResponsesApi();
    default:
      return (
        await import("@earendil-works/pi-ai/api/openai-completions.lazy")
      ).openAICompletionsApi();
  }
}

async function catalogModel(providerId: string, modelId: string) {
  const catalog = CATALOG[providerId];
  if (!catalog) return undefined;
  try {
    const { getBuiltinModels } =
      await import("@earendil-works/pi-ai/providers/all");
    return (getBuiltinModels(catalog as never) as Model<Api>[]).find(
      (model) => model.id === modelId,
    );
  } catch {
    return undefined;
  }
}

export async function createPiModel(
  provider: ResolvedProvider,
  modelId: string,
) {
  const api = API_OF[provider.kind];
  let baseUrl = provider.baseURL.replace(/\/+$/, "");
  // pi's Anthropic client appends /v1 itself.
  if (api === "anthropic-messages") baseUrl = baseUrl.replace(/\/v1$/, "");

  const known = await catalogModel(provider.id, modelId);
  const model: Model<Api> =
    known && known.api === api
      ? { ...known, provider: provider.id, baseUrl }
      : ({
          id: modelId,
          name: modelId,
          api,
          provider: provider.id,
          baseUrl,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 8192,
          ...(api === "openai-completions"
            ? { compat: COMPAT[provider.id] ?? {} }
            : {}),
        } as Model<Api>);

  const piProvider = createProvider({
    id: provider.id,
    name: provider.name,
    baseUrl,
    auth: {
      apiKey: {
        name: `${provider.name} API key`,
        // Keyless local servers (Ollama, llama.cpp) still need a placeholder
        // for the OpenAI client.
        resolve: async () => ({
          auth: { apiKey: provider.apiKey || "not-needed" },
          source: "settings",
        }),
      },
    },
    models: [model],
    api: { [api]: await loadApi(api) },
  });
  const models = createModels();
  models.setProvider(piProvider);
  return { model, models, streamFn: models.streamSimple.bind(models) };
}
