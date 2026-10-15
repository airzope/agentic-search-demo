import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import { runChat } from "@/lib/agent/run";
import type { ChatMessage } from "@/lib/agent/types";
import { LlmConfigError, getProvider } from "@/lib/llm";
import { parseKbId } from "@/lib/meili";
import type { SearchPrefs } from "@/lib/types";

export const maxDuration = 300;

type ChatBody = {
  /** Conversation id; lets the user steer the run while it works. */
  id?: string;
  messages: ChatMessage[];
  kbs?: string[];
  provider?: string;
  model?: string;
  search?: Partial<SearchPrefs>;
  /** Deep research mode for complex questions. */
  deep?: boolean;
};

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "An error occurred.";
}

/** RAG chat: a pi agent (search / browse / read tools) streamed as UI messages. */
export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  try {
    const kbIds = [...new Set((body.kbs ?? []).map((id) => parseKbId(id).id))];
    if (!kbIds.length) {
      return new Response("Select at least one knowledge base.", {
        status: 400,
      });
    }
    const provider = await getProvider(body.provider);
    const modelId = body.model?.trim() || provider.model;
    if (!modelId)
      throw new LlmConfigError(`${provider.name}: model is missing.`);

    const stream = createUIMessageStream<ChatMessage>({
      execute: ({ writer }) =>
        runChat({
          chatId: body.id || crypto.randomUUID(),
          messages: body.messages ?? [],
          kbIds,
          provider,
          modelId,
          prefs: body.search ?? {},
          deep: Boolean(body.deep),
          signal: request.signal,
          writer,
        }),
      onError: errorText,
    });
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    const status = error instanceof LlmConfigError ? 400 : 500;
    return new Response(errorText(error), { status });
  }
}
