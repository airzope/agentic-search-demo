import "server-only";

import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { UIMessageStreamWriter } from "ai";

import { toAgentMessages } from "@/lib/agent/history";
import { createPiModel } from "@/lib/agent/model";
import { SourceNumbers, createRagTools } from "@/lib/agent/tools";
import { collectSources, type ChatMessage } from "@/lib/agent/types";
import { singleton } from "@/lib/global";
import { browseTree } from "@/lib/kb/browse";
import { describeKb } from "@/lib/kb/catalog";
import type { ResolvedProvider } from "@/lib/settings";
import type { ChatMetadata, SearchPrefs } from "@/lib/types";

/** Running agents by chat id, so the user can steer a run in progress. */
const running = singleton("chat-agents", () => new Map<string, Agent>());

export function steerRun(chatId: string, text: string) {
  const agent = running.get(chatId);
  if (!agent?.state.isStreaming) return false;
  agent.steer({ role: "user", content: text, timestamp: Date.now() });
  return true;
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "An error occurred.";

/** Short description of each knowledge base for the system prompt. */
async function catalog(kbIds: string[]) {
  const lines = await Promise.all(
    kbIds.slice(0, 20).map(async (id) => {
      try {
        const kb = await describeKb(id);
        let detail = `${kb.stats.numberOfDocuments} documents`;
        if (kb.schema.chunked) {
          const tree = await browseTree(id, null, 0);
          const folders = tree.children
            .sort((a, b) => b.docs - a.docs)
            .slice(0, 12)
            .map((node) => `${node.name}(${node.docs})`)
            .join(", ");
          detail = `${tree.totalDocs} files${folders ? `; top folders: ${folders}` : ""}`;
        }
        const description = kb.config?.description
          ? ` — ${kb.config.description}`
          : "";
        return `- ${id} — ${kb.name}${description} — ${detail}`;
      } catch (error) {
        return `- ${id} — unavailable (${errorText(error)})`;
      }
    }),
  );
  return lines.join("\n");
}

const BASE_RULES = `Rules:
- Ground every answer in retrieved content. After each factual statement, cite the source numbers \`n\` from tool results in square brackets, e.g. 退款需在 14 天内申请[3]。
- When several sources support or add to a statement, cite all of them together: [2][5]. Prefer drawing on several sources over relying on a single one, and point out where they agree or differ.
- Only use numbers that appear in tool results. Never invent numbers, refs or sources, and do not write a separate reference list (the interface shows the sources).
- For Chinese, Japanese or Korean, prefer short key terms (2-6 characters) and try synonyms, abbreviations and full names as separate queries.
- When the question targets a specific area, restrict search with "kbs" or "branch" (a folder path from browse or result paths).
- Snippets are excerpts. When details matter (tables, steps, numbers, conditions), call read on the most relevant refs.
- If the knowledge bases do not contain the answer, say so plainly instead of guessing.
- Reply in the same language as the user's latest message.`;

const DEEP_RULES = `Deep research mode — the question may be complex:
1. Plan: first write a short list of the sub-questions you must answer.
2. Retrieve broadly: call search with 3-5 queries per call covering the sub-questions; use browse when the folder structure helps narrow down.
3. Read: open the 2-5 most relevant documents with read before answering.
4. Check gaps and conflicts: search again for anything still missing, with different wording.
5. Answer with a structured synthesis (headings, bullets, or a table when comparing), citing every source you rely on. Point out conflicting sources and remaining uncertainty.`;

export type RunOptions = {
  chatId: string;
  messages: ChatMessage[];
  kbIds: string[];
  provider: ResolvedProvider;
  modelId: string;
  prefs: Partial<SearchPrefs>;
  deep: boolean;
  signal: AbortSignal;
  writer: UIMessageStreamWriter<ChatMessage>;
};

/**
 * Run the pi agent loop for the latest user message and stream its events
 * to the browser as UI message chunks.
 */
export async function runChat(options: RunOptions) {
  const { writer, messages, deep } = options;
  const started = Date.now();
  const { model, streamFn } = await createPiModel(
    options.provider,
    options.modelId,
  );
  const latest = messages.at(-1);
  const prompt = latest?.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!latest || latest.role !== "user" || !prompt) {
    throw new Error("The last message must be a user message.");
  }

  const history = messages.slice(0, -1);
  const numbers = new SourceNumbers(collectSources(history).values());
  const instructions = [
    "You are a research assistant answering questions from the user's knowledge bases.",
    "",
    "Selected knowledge bases (id — name — size — structure):",
    await catalog(options.kbIds),
    "",
    "Tools: search (several queries at once), browse (folders and files), read (full text or context around a hit).",
    "",
    BASE_RULES,
    ...(deep ? ["", DEEP_RULES] : []),
  ].join("\n");

  const maxTurns = deep ? 16 : 7;
  let turns = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: instructions,
      model,
      thinkingLevel: model.reasoning ? (deep ? "medium" : "low") : "off",
      tools: createRagTools({
        kbIds: options.kbIds,
        prefs: options.prefs,
        numbers,
      }),
      messages: toAgentMessages(history, model),
    },
    streamFn,
    sessionId: options.chatId,
    toolExecution: "parallel",
    // Out of budget: refuse further tool calls so the model answers with what it has.
    beforeToolCall: async () =>
      turns >= maxTurns
        ? {
            block: true,
            reason:
              "Tool budget exhausted. Answer now using the sources already retrieved.",
          }
        : undefined,
  });

  const metadata: ChatMetadata = {
    provider: options.provider.name,
    model: options.modelId,
    deep,
  };
  writer.write({ type: "start", messageMetadata: metadata });

  // UI part ids for the content blocks of the assistant message being streamed.
  let message = 0;
  let promptSeen = false;
  let usage = { input: 0, output: 0 };
  const partId = (kind: string, index: number) => `${kind}-${message}-${index}`;

  agent.subscribe((event) => {
    switch (event.type) {
      case "turn_start":
        turns += 1;
        writer.write({ type: "start-step" });
        break;
      case "turn_end":
        writer.write({ type: "finish-step" });
        break;
      case "message_start":
        if (event.message.role === "assistant") message += 1;
        if (event.message.role === "user") {
          // The first user message is the prompt itself; later ones are steering.
          if (!promptSeen) promptSeen = true;
          else {
            const content = (event.message as UserMessage).content;
            const text =
              typeof content === "string"
                ? content
                : content
                    .map((block) => (block.type === "text" ? block.text : ""))
                    .join("");
            writer.write({ type: "data-steer", data: { text } });
          }
        }
        break;
      case "message_update": {
        const update = event.assistantMessageEvent;
        switch (update.type) {
          case "text_start":
            writer.write({
              type: "text-start",
              id: partId("t", update.contentIndex),
            });
            break;
          case "text_delta":
            writer.write({
              type: "text-delta",
              id: partId("t", update.contentIndex),
              delta: update.delta,
            });
            break;
          case "text_end":
            writer.write({
              type: "text-end",
              id: partId("t", update.contentIndex),
            });
            break;
          case "thinking_start":
            writer.write({
              type: "reasoning-start",
              id: partId("r", update.contentIndex),
            });
            break;
          case "thinking_delta":
            writer.write({
              type: "reasoning-delta",
              id: partId("r", update.contentIndex),
              delta: update.delta,
            });
            break;
          case "thinking_end":
            writer.write({
              type: "reasoning-end",
              id: partId("r", update.contentIndex),
            });
            break;
          case "toolcall_end":
            writer.write({
              type: "tool-input-available",
              toolCallId: update.toolCall.id,
              toolName: update.toolCall.name,
              input: update.toolCall.arguments,
            });
            break;
        }
        break;
      }
      case "message_end":
        if (event.message.role === "assistant") {
          const final = event.message as AssistantMessage;
          usage = {
            input: usage.input + final.usage.input,
            output: usage.output + final.usage.output,
          };
          if (final.stopReason === "error") {
            writer.write({
              type: "error",
              errorText: final.errorMessage || "The model request failed.",
            });
          }
        }
        break;
      case "tool_execution_end":
        if (event.isError) {
          const content = (event.result?.content ?? []) as { text?: string }[];
          writer.write({
            type: "tool-output-error",
            toolCallId: event.toolCallId,
            errorText:
              content.map((block) => block.text ?? "").join("") ||
              "Tool failed",
          });
        } else {
          writer.write({
            type: "tool-output-available",
            toolCallId: event.toolCallId,
            output: event.result?.details ?? null,
          });
        }
        break;
    }
  });

  const abort = () => agent.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  running.set(options.chatId, agent);
  try {
    await agent.prompt(prompt);
  } finally {
    options.signal.removeEventListener("abort", abort);
    if (running.get(options.chatId) === agent) running.delete(options.chatId);
  }
  writer.write({
    type: "finish",
    messageMetadata: {
      ...metadata,
      usage,
      durationMs: Date.now() - started,
    },
  });
}
