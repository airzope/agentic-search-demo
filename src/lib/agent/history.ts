import "server-only";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";

import type { ChatMessage } from "@/lib/agent/types";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Assistant turns whose tool calls and results stay in the model context. */
const DETAILED_TURNS = 3;
/** Older tool results are cut to this many characters. */
const OLD_RESULT_CHARS = 2500;

type Part = ChatMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

const isToolPart = (part: Part): part is ToolPart =>
  part.type.startsWith("tool-") && "toolCallId" in part;

type ResultSource = {
  n?: number;
  primaryKey?: unknown;
  title?: string;
  properties?: unknown;
  table?: { columns: string[]; rows: unknown[][] };
  value?: unknown;
  query?: string;
};

/**
 * Ontology results as the model first saw them: the UI copy also carries
 * links, snippets and timestamps that would only fill the context.
 */
function modelView(name: string, output: unknown) {
  const value = (output ?? {}) as Record<string, unknown>;
  if (name === "ontology_find" || name === "ontology_links") {
    return {
      objectType: value.objectType,
      query: value.query,
      totalCount: value.totalCount,
      hasMore: value.hasMore,
      via: value.via,
      objects: ((value.objects ?? []) as ResultSource[]).map((object) => ({
        n: object.n,
        primaryKey: object.primaryKey,
        title: object.title,
        properties: object.properties,
      })),
    };
  }
  if (name === "ontology_aggregate") {
    const source = value as ResultSource;
    return {
      n: source.n,
      query: source.query,
      columns: source.table?.columns,
      rows: source.table?.rows,
    };
  }
  if (name === "ontology_function") {
    const source = value as ResultSource;
    return { n: source.n, title: source.title, value: source.value };
  }
  return output ?? null;
}

const textOf = (message: ChatMessage) =>
  message.parts
    .filter(
      (part): part is Extract<Part, { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();

/**
 * Convert UI messages (as kept by the browser) into pi agent messages:
 * each assistant step becomes an assistant message with its tool calls,
 * followed by the tool results; mid-run guidance becomes a user message.
 */
export function toAgentMessages(
  messages: ChatMessage[],
  model: Model<Api>,
): AgentMessage[] {
  const assistantIndexes = messages
    .map((message, index) => (message.role === "assistant" ? index : -1))
    .filter((index) => index >= 0);
  const detailedFrom =
    assistantIndexes[Math.max(0, assistantIndexes.length - DETAILED_TURNS)] ??
    0;

  const output: AgentMessage[] = [];
  const assistant = (
    content: (TextContent | ToolCall)[],
    timestamp: number,
  ): AssistantMessage => ({
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop",
    timestamp,
  });

  messages.forEach((message, index) => {
    const timestamp = Date.now() - (messages.length - index) * 1000;
    if (message.role === "user") {
      const text = textOf(message);
      if (text) output.push({ role: "user", content: text, timestamp });
      return;
    }
    if (message.role !== "assistant") return;

    // Older turns: final text only, to keep the context small.
    if (index < detailedFrom) {
      const text = textOf(message);
      if (text) output.push(assistant([{ type: "text", text }], timestamp));
      return;
    }

    const last = index === assistantIndexes.at(-1);
    let content: (TextContent | ToolCall)[] = [];
    let results: ToolResultMessage[] = [];
    const flush = () => {
      if (content.length) output.push(assistant(content, timestamp));
      output.push(...results);
      content = [];
      results = [];
    };
    for (const part of message.parts) {
      if (part.type === "step-start") {
        flush();
      } else if (part.type === "text" && part.text.trim()) {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "data-steer") {
        flush();
        output.push({ role: "user", content: part.data.text, timestamp });
      } else if (isToolPart(part)) {
        const name = part.type.slice("tool-".length);
        const done =
          part.state === "output-available" || part.state === "output-error";
        if (!done) continue; // interrupted call: drop it
        content.push({
          type: "toolCall",
          id: part.toolCallId,
          name,
          arguments: (part.input ?? {}) as ToolCall["arguments"],
        });
        let text =
          part.state === "output-error"
            ? `Error: ${part.errorText ?? "failed"}`
            : JSON.stringify(modelView(name, part.output));
        if (!last && text.length > OLD_RESULT_CHARS) {
          text = `${text.slice(0, OLD_RESULT_CHARS)}…`;
        }
        results.push({
          role: "toolResult",
          toolCallId: part.toolCallId,
          toolName: name,
          content: [{ type: "text", text }],
          isError: part.state === "output-error",
          timestamp,
        } as ToolResultMessage);
      }
    }
    flush();
  });
  return output;
}
