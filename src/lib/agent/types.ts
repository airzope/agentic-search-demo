/** Chat agent types shared by the API route and the chat page. */
import type { UIMessage } from "ai";

import type { ObjectTypeDetail, ParameterSummary } from "@/lib/ontology/types";
import type { ChatMetadata } from "@/lib/types";

/**
 * What a source is: a knowledge-base chunk, an ontology object, or a result
 * computed by Foundry (aggregation, function).
 */
export type SourceKind = "doc" | "object" | "aggregate" | "function";

/**
 * A retrieved source. `n` is its citation number, stable for the whole
 * conversation: the same chunk keeps its number in later turns, so answers can
 * cite several sources as [1][3].
 */
export type Source = {
  n: number;
  ref: string;
  /** Missing on knowledge-base sources from earlier versions. */
  kind?: SourceKind;
  kb?: string;
  title?: string;
  path?: string;
  heading?: string;
  snippet?: string;
  /* Ontology sources */
  /** Ontology connection id and name. */
  ontology?: string;
  ontologyName?: string;
  /** Object type API name and display name. */
  objectType?: string;
  objectTypeName?: string;
  primaryKey?: string | number;
  /** Object properties as retrieved (the cited snapshot). */
  properties?: Record<string, unknown>;
  /** Properties the snapshot covers; those missing from it were null. */
  fields?: string[];
  /** Aggregation result. */
  table?: { columns: string[]; rows: unknown[][]; truncated?: boolean };
  /** Function result. */
  value?: unknown;
  /** Object Explorer link. */
  url?: string;
  /** The OSDK call that produced the source (provenance). */
  query?: string;
  /** Retrieval time (ISO). */
  at?: string;
};

export const isOntologySource = (source: Source) =>
  source.kind === "object" ||
  source.kind === "aggregate" ||
  source.kind === "function";

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

export type OntologySchemaOutput = {
  ontology: string;
  ontologyName: string;
  /** List mode: object types matching the search. */
  objectTypes?: {
    apiName: string;
    displayName: string;
    description?: string;
  }[];
  totalObjectTypes?: number;
  functions?: {
    apiName: string;
    description?: string;
    parameters: string;
    output: string;
  }[];
  actions?: { apiName: string; description?: string; parameters: string }[];
  /** Detail mode: one object type. */
  objectType?: ObjectTypeDetail;
};

export type OntologyObjectsOutput = {
  ontology: string;
  ontologyName: string;
  objectType: string;
  objectTypeName: string;
  query: string;
  totalCount?: number;
  hasMore: boolean;
  objects: Source[];
  /** Set for linked objects: the object they were reached from. */
  via?: { objectType: string; primaryKey: string | number; link: string };
};

/** An action the agent proposes; a person approves it in the chat. */
export type ActionProposalOutput = {
  ontology: string;
  ontologyName: string;
  action: string;
  actionName?: string;
  description?: string;
  parameters: Record<string, unknown>;
  parameterInfo: ParameterSummary[];
  validation: { result: "VALID" | "INVALID"; messages: string[] };
  reason?: string;
};

/**
 * Verification of one claim of an answer: `unjudged` means the citations
 * exist and the numbers match, but no model judged the claim.
 */
export type ClaimStatus =
  "supported" | "partial" | "unsupported" | "uncited" | "neutral" | "unjudged";

export type VerifiedClaim = {
  id: number;
  text: string;
  cited: number[];
  /** Cited numbers that match no source. */
  missing: number[];
  /** Quantities in the claim and whether the cited sources contain them. */
  numbers: { text: string; found: boolean }[];
  status: ClaimStatus;
  reason?: string;
};

export type Verification = {
  messageId: string;
  at: string;
  model?: string;
  /** Whether a model judged the claims (else only deterministic checks). */
  judged: boolean;
  error?: string;
  claims: VerifiedClaim[];
  summary: Record<ClaimStatus, number>;
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
      } else if (
        part.type === "tool-ontology_find" ||
        part.type === "tool-ontology_links"
      ) {
        for (const object of (part.output as OntologyObjectsOutput).objects ??
          []) {
          add(object);
        }
      } else if (
        part.type === "tool-ontology_aggregate" ||
        part.type === "tool-ontology_function"
      ) {
        add(part.output as Source);
      }
    }
  }
  return sources;
}
