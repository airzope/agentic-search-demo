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
import { browseTree, readDocument } from "@/lib/kb/browse";
import { describeKb } from "@/lib/kb/catalog";
import { parseRef, retrieve, type KbHit } from "@/lib/kb/retrieve";
import { LlmConfigError, createModel, getProvider } from "@/lib/llm";
import { parseKbId } from "@/lib/meili";
import type { ChatMetadata, SearchPrefs } from "@/lib/types";

export const maxDuration = 300;

type ChatBody = {
  messages: UIMessage[];
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

const compactHit = (hit: KbHit) => ({
  ref: hit.ref,
  kb: hit.kbName,
  title: stripHighlights(hit.titleHighlighted || hit.title),
  path: hit.path ?? undefined,
  heading: hit.heading ?? undefined,
  snippet: stripHighlights(hit.snippet).slice(0, 600),
  score: Math.round(hit.score * 1000) / 1000,
  ...(Object.keys(hit.fields).length ? { fields: hit.fields } : {}),
});

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
- Ground every answer in retrieved content. Cite each factual statement inline as [n](#doc-<ref>) using the exact "ref" from tool results; number distinct sources in order of first use.
- For Chinese, Japanese or Korean, prefer short key terms (2-6 characters) and try synonyms, abbreviations and full names as separate queries.
- When the question targets a specific area, restrict search with "kbs" or "branch" (a folder path from browse or from result paths).
- Snippets are excerpts. When details matter (tables, steps, numbers, conditions), call read on the most relevant refs.
- If the knowledge bases do not contain the answer, say so plainly instead of guessing.
- Reply in the same language as the user's latest message.`;

const DEEP_RULES = `Deep research mode — the question may be complex:
1. Plan: first write a short list of the sub-questions you must answer.
2. Retrieve broadly: call search with 3-5 queries per call covering the sub-questions; use browse when the folder structure helps narrow down.
3. Read: open the 2-5 most relevant documents with read before answering.
4. Check gaps and conflicts: search again for anything still missing, with different wording.
5. Answer with a structured synthesis (headings, bullets, or a table when comparing). Point out conflicting sources and remaining uncertainty.`;

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
    const model = createModel(provider, modelId);
    const prefs = body.search ?? {};
    const deep = Boolean(body.deep);

    const allowed = (ids?: string[]) => {
      const picked = (ids ?? []).filter((id) => kbIds.includes(id));
      return picked.length ? picked : kbIds;
    };
    const ensureAllowed = (id: string) => {
      const kbId = parseKbId(id).id;
      if (!kbIds.includes(kbId))
        throw new Error(`Knowledge base not selected: ${id}`);
      return kbId;
    };

    const tools = {
      search: tool({
        description:
          "Search the selected knowledge bases (hybrid keyword + semantic). Pass several focused queries at once; they run in parallel and duplicates across queries are marked.",
        inputSchema: z.object({
          queries: z.array(z.string().min(1).max(200)).min(1).max(5),
          kbs: z
            .array(z.string())
            .optional()
            .describe(
              "Restrict to these knowledge base ids (default: all selected)",
            ),
          branch: z
            .string()
            .optional()
            .describe(
              "Folder path to restrict to, e.g. 产品/手册 (chunked knowledge bases only)",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Results per query, default 6"),
        }),
        execute: async ({ queries, kbs, branch, limit }) => {
          const targets = allowed(kbs);
          const seen = new Set<string>();
          const results = await Promise.all(
            queries.map((q) =>
              retrieve({
                kbIds: targets,
                q,
                prefs,
                branch,
                limit: limit ?? 6,
                cropLength: 80,
              }),
            ),
          );
          return {
            results: results.map((result, at) => ({
              query: queries[at],
              total: result.estimatedTotalHits,
              hits: result.hits.map((hit) => {
                if (seen.has(hit.ref)) return { ref: hit.ref, duplicate: true };
                seen.add(hit.ref);
                return compactHit(hit);
              }),
              ...(result.warnings.length ? { warnings: result.warnings } : {}),
              ...(result.errors.length ? { errors: result.errors } : {}),
            })),
          };
        },
      }),
      browse: tool({
        description:
          "List the folders (with file counts) and files of a knowledge base folder, to understand its structure.",
        inputSchema: z.object({
          kb: z.string().describe("Knowledge base id"),
          branch: z
            .string()
            .optional()
            .describe("Folder path; omit for the top level"),
        }),
        execute: async ({ kb, branch }) => {
          const kbId = ensureAllowed(kb);
          const tree = await browseTree(kbId, branch || null, 40);
          return {
            branch: tree.branch ?? "/",
            totalFiles: tree.totalDocs,
            folders: tree.children.map((node) => ({
              branch: node.branch,
              files: node.docs,
            })),
            files: tree.documents.map((doc) => ({
              ref: `${kbId}~${doc.doc_id}`,
              title: doc.title,
              path: doc.path,
            })),
          };
        },
      }),
      read: tool({
        description:
          "Read a document by ref: the whole text, or only the chunks around a search hit (around_hit_only).",
        inputSchema: z.object({
          ref: z.string().describe("A ref from search or browse results"),
          around_hit_only: z
            .boolean()
            .optional()
            .describe("Only read a few chunks around the hit's chunk"),
          max_chars: z.number().int().min(1000).max(12000).optional(),
        }),
        execute: async ({ ref, around_hit_only, max_chars }) => {
          const parsed = parseRef(ref);
          if (!parsed) throw new Error(`Invalid ref: ${ref}`);
          const document = await readDocument(
            ensureAllowed(parsed.kbId),
            parsed.docId,
            {
              around: around_hit_only ? parsed.chunk : null,
              window: 3,
              maxChars: max_chars ?? 8000,
            },
          );
          return {
            ref,
            title: document.title,
            path: document.path ?? undefined,
            chunkCount: document.chunkCount,
            truncated: document.truncated,
            text: document.chunks
              .map(
                (chunk) =>
                  `${chunk.heading ? `[${chunk.heading}]\n` : ""}${chunk.content}`,
              )
              .join("\n\n"),
          };
        },
      }),
    };

    const instructions = [
      "You are a research assistant answering questions from the user's knowledge bases.",
      "",
      "Selected knowledge bases (id — name — size — structure):",
      await catalog(kbIds),
      "",
      "Tools: search (several queries at once), browse (folders and files), read (full text or context around a hit).",
      "",
      BASE_RULES,
      ...(deep ? ["", DEEP_RULES] : []),
    ].join("\n");

    const result = streamText({
      model,
      instructions,
      messages: await convertToModelMessages(body.messages),
      tools,
      stopWhen: isStepCount(deep ? 20 : 8),
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
                deep,
              } satisfies ChatMetadata)
            : undefined,
      }),
    });
  } catch (error) {
    const status = error instanceof LlmConfigError ? 400 : 500;
    return new Response(errorText(error), { status });
  }
}
