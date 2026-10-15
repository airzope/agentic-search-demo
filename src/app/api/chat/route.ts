import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { stripHighlights } from "@/lib/cjk";
import { fieldText } from "@/lib/display";
import { LlmConfigError, createModel, getProvider } from "@/lib/llm";
import { getMeili, isValidIndexUid } from "@/lib/meili";
import { buildSearchParams, defaultLocales, describeIndex } from "@/lib/search";
import type {
  ChatHit,
  ChatMetadata,
  SearchHit,
  SearchPrefs,
} from "@/lib/types";

export const maxDuration = 120;

type ChatBody = {
  messages: UIMessage[];
  indexUid?: string;
  provider?: string;
  model?: string;
  search?: Partial<SearchPrefs>;
};

const MAX_FIELD_CHARS = 4000;

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "An error occurred.";
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  try {
    if (!body.indexUid || !isValidIndexUid(body.indexUid)) {
      return new Response("Select an index first.", { status: 400 });
    }
    const provider = await getProvider(body.provider);
    const modelId = body.model?.trim() || provider.model;
    const model = createModel(provider, modelId);

    const index = (await getMeili()).index(body.indexUid);
    const meta = await describeIndex(index);
    const primaryKey = meta.primaryKey ?? "id";
    const { title, content } = meta.display;
    const filterable = (meta.settings.filterableAttributes ?? []).filter(
      (attribute): attribute is string => typeof attribute === "string",
    );
    const prefs: Partial<SearchPrefs> = {
      ...body.search,
      locales: body.search?.locales?.length
        ? body.search.locales
        : defaultLocales(meta.settings.localizedAttributes),
    };

    const toChatHit = (hit: SearchHit): ChatHit => {
      const formatted = hit._formatted ?? {};
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(hit)) {
        if (key.startsWith("_") || [primaryKey, title, content].includes(key))
          continue;
        const text = fieldText(value);
        if (text && text.length <= 120 && Object.keys(fields).length < 6) {
          fields[key] = text;
        }
      }
      return {
        id: fieldText(hit[primaryKey]),
        title: title ? fieldText(hit[title]) : "",
        snippet: stripHighlights(
          fieldText(content ? (formatted[content] ?? hit[content]) : ""),
        ).slice(0, 500),
        score:
          typeof hit._rankingScore === "number"
            ? Math.round(hit._rankingScore * 1000) / 1000
            : undefined,
        fields,
      };
    };

    const searchInput = z.object({
      query: z
        .string()
        .min(1)
        .max(200)
        .describe("Keywords or a short natural-language query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of results, default 8"),
      ...(filterable.length
        ? {
            filter: z
              .string()
              .max(500)
              .optional()
              .describe(
                `Optional Meilisearch filter, e.g. ${filterable[0]} = "value". Filterable attributes: ${filterable.join(", ")}`,
              ),
          }
        : {}),
    });

    const tools = {
      search_documents: tool({
        description: `Search the "${meta.uid}" index (${prefs.mode ?? "keyword"} search). Returns matching documents with id, title and snippet.`,
        inputSchema: searchInput,
        execute: async (input) => {
          const { query, limit } = input;
          const filter = (input as { filter?: string }).filter;
          const response = await index.search(
            query,
            buildSearchParams(prefs, {
              limit: limit ?? 8,
              filter: filter || undefined,
            }),
          );
          return {
            query,
            total: response.estimatedTotalHits ?? response.hits.length,
            hits: response.hits.map(toChatHit),
          };
        },
      }),
      get_document: tool({
        description: "Fetch one full document by its id.",
        inputSchema: z.object({
          id: z.string().min(1).describe("Document id from search results"),
        }),
        execute: async ({ id }) => {
          const document = await index.getDocument(id);
          return Object.fromEntries(
            Object.entries(document)
              .filter(([key]) => !key.startsWith("_"))
              .map(([key, value]) => {
                const text = fieldText(value);
                return [
                  key,
                  text.length > MAX_FIELD_CHARS
                    ? `${text.slice(0, MAX_FIELD_CHARS)}…`
                    : value,
                ];
              }),
          );
        },
      }),
    };

    const instructions = [
      `You are a search assistant for the Meilisearch index "${meta.uid}" (${meta.stats.numberOfDocuments} documents).`,
      `Documents have the primary key "${primaryKey}"${title ? `, title field "${title}"` : ""}${content ? `, content field "${content}"` : ""}.`,
      "",
      "Rules:",
      "- Use search_documents before answering questions about the data. Search several times with different keywords when results are weak.",
      "- For Chinese, Japanese or Korean queries prefer short key terms (2-4 characters each) over full sentences, and try synonyms.",
      "- Answer only from retrieved documents. If nothing relevant is found, say so plainly.",
      "- Cite sources inline with markdown links like [1](#doc-<id>), numbering distinct documents in order of first use.",
      "- Reply in the same language as the user's latest message. Be concise.",
    ].join("\n");

    const result = streamText({
      model,
      instructions,
      messages: await convertToModelMessages(body.messages),
      tools,
      stopWhen: isStepCount(6),
      onToolExecutionEnd({ toolCall, toolOutput }) {
        if (toolOutput.type === "tool-error") {
          console.error(`[chat] ${toolCall.toolName} failed`, toolOutput.error);
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        onError: errorText,
        messageMetadata: ({ part }) =>
          part.type === "start"
            ? ({
                provider: provider.name,
                model: modelId,
              } satisfies ChatMetadata)
            : undefined,
      }),
    });
  } catch (error) {
    const status = error instanceof LlmConfigError ? 400 : 500;
    return new Response(errorText(error), { status });
  }
}
