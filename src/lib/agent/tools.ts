import "server-only";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type {
  BrowseToolOutput,
  ReadToolOutput,
  SearchToolOutput,
  Source,
} from "@/lib/agent/types";
import { stripHighlights } from "@/lib/cjk";
import { browseTree, readDocument } from "@/lib/kb/browse";
import { parseRef, retrieve, type KbHit } from "@/lib/kb/retrieve";
import { parseKbId } from "@/lib/meili";
import type { SearchPrefs } from "@/lib/types";

/** Assigns conversation-stable citation numbers to refs. */
export class SourceNumbers {
  private byRef = new Map<string, number>();
  private next = 1;

  constructor(existing: Iterable<Source>) {
    for (const source of existing) {
      this.byRef.set(source.ref, source.n);
      this.next = Math.max(this.next, source.n + 1);
    }
  }

  number(ref: string) {
    let n = this.byRef.get(ref);
    if (n === undefined) {
      n = this.next++;
      this.byRef.set(ref, n);
    }
    return n;
  }
}

const toSource = (hit: KbHit, n: number): Source => ({
  n,
  ref: hit.ref,
  kb: hit.kbName,
  title: stripHighlights(hit.titleHighlighted || hit.title),
  path: hit.path ?? undefined,
  heading: hit.heading ?? undefined,
  snippet: stripHighlights(hit.snippet).slice(0, 600),
});

/** Tool results go to the model as compact JSON; `details` feed the UI. */
const result = <T>(details: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(details) }],
  details,
});

export function createRagTools({
  kbIds,
  prefs,
  numbers,
}: {
  kbIds: string[];
  prefs: Partial<SearchPrefs>;
  numbers: SourceNumbers;
}): AgentTool[] {
  const allowed = (ids?: string[]) => {
    const picked = (ids ?? [])
      .map((id) => {
        try {
          return parseKbId(id).id;
        } catch {
          return "";
        }
      })
      .filter((id) => kbIds.includes(id));
    return picked.length ? picked : kbIds;
  };
  const ensureAllowed = (id: string) => {
    const kbId = parseKbId(id).id;
    if (!kbIds.includes(kbId)) {
      throw new Error(`Knowledge base not selected: ${id}`);
    }
    return kbId;
  };

  const search: AgentTool = {
    name: "search",
    label: "Search",
    description:
      "Search the selected knowledge bases (hybrid keyword + semantic). Pass several focused queries at once; they run in parallel. Every hit has a citation number `n`; hits already returned earlier are marked duplicate.",
    parameters: Type.Object({
      queries: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        minItems: 1,
        maxItems: 5,
        description: "1-5 short queries; for CJK use key terms and synonyms",
      }),
      kbs: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Restrict to these knowledge base ids (default: all selected)",
        }),
      ),
      branch: Type.Optional(
        Type.String({
          description: "Folder path to search within, e.g. 产品/手册",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 10,
          description: "Hits per query, default 6",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { queries, kbs, branch, limit } = params as {
        queries: string[];
        kbs?: string[];
        branch?: string;
        limit?: number;
      };
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
      const output: SearchToolOutput = {
        results: results.map((found, at) => ({
          query: queries[at],
          total: found.estimatedTotalHits,
          hits: found.hits.map((hit) => {
            const n = numbers.number(hit.ref);
            if (seen.has(hit.ref)) {
              return { n, ref: hit.ref, duplicate: true as const };
            }
            seen.add(hit.ref);
            return toSource(hit, n);
          }),
          ...(found.warnings.length ? { warnings: found.warnings } : {}),
          ...(found.errors.length ? { errors: found.errors } : {}),
        })),
      };
      return result(output);
    },
  };

  const browse: AgentTool = {
    name: "browse",
    label: "Browse",
    description:
      "List the folders (with file counts) and files of a knowledge base folder, to understand its structure before searching or reading.",
    parameters: Type.Object({
      kb: Type.String({ description: "Knowledge base id" }),
      branch: Type.Optional(
        Type.String({ description: "Folder path; omit for the top level" }),
      ),
    }),
    execute: async (_id, params) => {
      const { kb, branch } = params as { kb: string; branch?: string };
      const kbId = ensureAllowed(kb);
      const tree = await browseTree(kbId, branch || null, 40);
      const output: BrowseToolOutput = {
        kb: kbId,
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
      return result(output);
    },
  };

  const read: AgentTool = {
    name: "read",
    label: "Read",
    description:
      "Read a document by ref: the whole text, or only the chunks around a search hit (around_hit_only). Returns a citation number `n` for the passage.",
    parameters: Type.Object({
      ref: Type.String({ description: "A ref from search or browse results" }),
      around_hit_only: Type.Optional(
        Type.Boolean({ description: "Only read a few chunks around the hit" }),
      ),
      max_chars: Type.Optional(Type.Integer({ minimum: 1000, maximum: 12000 })),
    }),
    execute: async (_id, params) => {
      const { ref, around_hit_only, max_chars } = params as {
        ref: string;
        around_hit_only?: boolean;
        max_chars?: number;
      };
      const parsed = parseRef(ref);
      if (!parsed) throw new Error(`Invalid ref: ${ref}`);
      const kbId = ensureAllowed(parsed.kbId);
      const document = await readDocument(kbId, parsed.docId, {
        around: around_hit_only ? parsed.chunk : null,
        window: 3,
        maxChars: max_chars ?? 8000,
      });
      const output: ReadToolOutput = {
        n: numbers.number(ref),
        ref,
        kb: document.kbName,
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
      return result(output);
    },
  };

  return [search, browse, read];
}
