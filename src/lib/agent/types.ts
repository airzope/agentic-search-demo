/** Chat agent types shared by the API route and the chat page. */
import type { UIMessage } from "ai";

import type { ChatMetadata } from "@/lib/types";

/**
 * A retrieved source. `n` is its citation number, stable for the whole
 * conversation: the same chunk keeps its number in later turns, so answers can
 * cite several sources as [1][3].
 */
export type Source = {
  n: number;
  ref: string;
  kb?: string;
  title?: string;
  path?: string;
  heading?: string;
  snippet?: string;
};

export type SearchToolOutput = {
  results: {
    query: string;
    total?: number;
    hits: (Source | { n: number; ref: string; duplicate: true })[];
    warnings?: string[];
    errors?: { scope: string; message: string }[];
  }[];
};

export type ReadToolOutput = Source & {
  chunkCount: number;
  truncated: boolean;
  text: string;
};

export type BrowseToolOutput = {
  kb: string;
  branch: string;
  totalFiles: number;
  folders: { branch: string; files: number }[];
  files: { ref: string; title: string; path: string }[];
};

/** Data parts streamed alongside text: user guidance injected mid-run. */
export type ChatDataParts = { steer: { text: string } };

export type ChatMessage = UIMessage<ChatMetadata, ChatDataParts>;

type ToolLikePart = {
  type: string;
  state?: string;
  output?: unknown;
};

/** Every source seen in the given messages, by citation number. */
export function collectSources(messages: { parts: ToolLikePart[] }[]) {
  const sources = new Map<number, Source>();
  const add = (source: Partial<Source> & { n?: number; ref?: string }) => {
    if (typeof source.n !== "number" || !source.ref) return;
    const previous = sources.get(source.n);
    sources.set(source.n, { ...previous, ...(source as Source) });
  };
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.state !== "output-available" || !part.output) continue;
      if (part.type === "tool-search") {
        for (const result of (part.output as SearchToolOutput).results ?? []) {
          for (const hit of result.hits) {
            if (!("duplicate" in hit)) add(hit);
          }
        }
      } else if (part.type === "tool-read") {
        const { text, ...source } = part.output as ReadToolOutput;
        add({ ...source, snippet: text?.slice(0, 400) });
      }
    }
  }
  return sources;
}
