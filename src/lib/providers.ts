import type { OcrModelId, OcrSource } from "@/lib/ocr/catalog";

/**
 * LLM provider presets. Shared by server and client, so no secrets here.
 *
 * Every preset maps to one of four AI SDK provider kinds. Vendors that speak
 * the OpenAI chat-completions protocol (most Chinese vendors and local
 * runtimes) all use `openai-compatible`.
 */
export type ProviderKind =
  "openai" | "anthropic" | "google" | "openai-compatible";

export type ProviderPreset = {
  id: string;
  kind: ProviderKind;
  name: string;
  /** Default base URL; empty for "custom". */
  baseURL: string;
  /** Default model; users can override or fetch the live list. */
  model: string;
  /** Prefix for `<PREFIX>_API_KEY`, `<PREFIX>_BASE_URL`, `<PREFIX>_MODEL`. */
  envPrefix: string;
  /** Extra env names accepted for the API key. */
  keyEnvAliases?: string[];
  keyRequired: boolean;
  group: "global" | "cn" | "local";
  keyUrl?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    kind: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    envPrefix: "OPENAI",
    keyRequired: true,
    group: "global",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    kind: "anthropic",
    name: "Anthropic Claude",
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-opus-5-5",
    envPrefix: "ANTHROPIC",
    keyRequired: true,
    group: "global",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    kind: "google",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    envPrefix: "GEMINI",
    keyEnvAliases: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    keyRequired: true,
    group: "global",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    kind: "openai-compatible",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5-mini",
    envPrefix: "OPENROUTER",
    keyRequired: true,
    group: "global",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "deepseek",
    kind: "openai-compatible",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    envPrefix: "DEEPSEEK",
    keyRequired: true,
    group: "cn",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "qwen",
    kind: "openai-compatible",
    name: "通义千问 Qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    envPrefix: "DASHSCOPE",
    keyRequired: true,
    group: "cn",
    keyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
  },
  {
    id: "kimi",
    kind: "openai-compatible",
    name: "Kimi (Moonshot)",
    baseURL: "https://api.moonshot.cn/v1",
    model: "kimi-latest",
    envPrefix: "MOONSHOT",
    keyRequired: true,
    group: "cn",
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "zhipu",
    kind: "openai-compatible",
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5-flash",
    envPrefix: "ZHIPU",
    keyRequired: true,
    group: "cn",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "doubao",
    kind: "openai-compatible",
    name: "豆包 (火山方舟)",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-250615",
    envPrefix: "ARK",
    keyRequired: true,
    group: "cn",
    keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
  },
  {
    id: "siliconflow",
    kind: "openai-compatible",
    name: "硅基流动 SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3-8B",
    envPrefix: "SILICONFLOW",
    keyRequired: true,
    group: "cn",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "ollama",
    kind: "openai-compatible",
    name: "Ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    model: "qwen3:8b",
    envPrefix: "OLLAMA",
    keyRequired: false,
    group: "local",
  },
  {
    id: "custom",
    kind: "openai-compatible",
    name: "OpenAI Compatible",
    baseURL: "",
    model: "",
    envPrefix: "OPENAI_COMPATIBLE",
    keyRequired: false,
    group: "local",
  },
];

export function getPreset(id: string) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/** What the browser is allowed to know about a provider. */
export type PublicProvider = {
  id: string;
  kind: ProviderKind;
  name: string;
  group: ProviderPreset["group"];
  baseURL: string;
  defaultBaseURL: string;
  model: string;
  defaultModel: string;
  keyRequired: boolean;
  keyUrl?: string;
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  keyHint: string | null;
  /** Ready to be used for chat. */
  configured: boolean;
};

/** A Meilisearch instance. `local` comes from the classic Meilisearch settings. */
export type PublicConnection = {
  id: string;
  name: string;
  host: string;
  hasKey: boolean;
  keyHint: string | null;
  builtin: boolean;
};

export type EmbeddingEngine = "builtin" | "remote";
export type ModelSource = "huggingface" | "hf-mirror" | "modelscope" | "custom";

export type PublicEmbedding = {
  engine: EmbeddingEngine;
  builtin: {
    model: string;
    file: string;
    source: ModelSource;
    url: string;
  };
  remote: {
    baseURL: string;
    model: string;
    hasKey: boolean;
    keyHint: string | null;
  };
  queryInstruction: string;
};

export type PublicOcr = {
  enabled: boolean;
  model: OcrModelId;
  source: OcrSource;
  baseUrl: string;
  pypiIndex: string;
};

export type PublicSettings = {
  connections: PublicConnection[];
  embedding: PublicEmbedding;
  ocr: PublicOcr;
  meilisearch: {
    host: string;
    hostSource: "settings" | "env" | "default";
    hasKey: boolean;
    keySource: "settings" | "env" | null;
    keyHint: string | null;
  };
  llm: {
    active: string | null;
    providers: PublicProvider[];
  };
};

/**
 * Patch semantics: `undefined` keeps a value, `null` or `""` clears it
 * (falling back to `.env` / preset defaults).
 */
export type SettingsPatch = {
  meilisearch?: { host?: string | null; apiKey?: string | null };
  connections?: {
    upsert?: {
      id: string;
      name?: string;
      host?: string;
      apiKey?: string | null;
    }[];
    remove?: string[];
  };
  embedding?: {
    engine?: EmbeddingEngine | null;
    source?: ModelSource | null;
    url?: string | null;
    baseURL?: string | null;
    apiKey?: string | null;
    model?: string | null;
    queryInstruction?: string | null;
  };
  ocr?: {
    enabled?: boolean;
    model?: OcrModelId;
    source?: OcrSource | null;
    baseUrl?: string | null;
    pypiIndex?: string | null;
  };
  llm?: {
    active?: string | null;
    providers?: Record<
      string,
      {
        apiKey?: string | null;
        baseURL?: string | null;
        model?: string | null;
      } | null
    >;
  };
};

/** The model shipped with the app: Qwen3-Embedding-0.6B as GGUF for llama.cpp. */
export const BUILTIN_EMBEDDING = {
  id: "qwen3-embedding-0.6b",
  file: "Qwen3-Embedding-0.6B-Q8_0.gguf",
  dimensions: 1024,
  /** Qwen3-Embedding supports Matryoshka (MRL) truncation down to 32 dims. */
  dimensionOptions: [1024, 768, 512, 256] as const,
  urls: {
    huggingface:
      "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf",
    "hf-mirror":
      "https://hf-mirror.com/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf",
    modelscope:
      "https://modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/master/Qwen3-Embedding-0.6B-Q8_0.gguf",
  },
} as const;

export const DEFAULT_QUERY_INSTRUCTION =
  "Given a web search query, retrieve relevant passages that answer the query";

/** Common OpenAI-compatible embedding services for Qwen3-Embedding. */
export const REMOTE_EMBEDDING_PRESETS = [
  {
    id: "ollama",
    name: "Ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    model: "qwen3-embedding:0.6b",
  },
  {
    id: "llamacpp",
    name: "llama.cpp / TEI / vLLM",
    baseURL: "http://127.0.0.1:8080/v1",
    model: "Qwen/Qwen3-Embedding-0.6B",
  },
  {
    id: "dashscope",
    name: "阿里云百炼 text-embedding-v4",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "text-embedding-v4",
  },
  {
    id: "siliconflow",
    name: "硅基流动 Qwen3-Embedding-8B",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3-Embedding-8B",
  },
] as const;
