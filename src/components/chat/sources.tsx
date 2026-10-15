"use client";

import {
  BoxIcon,
  FileTextIcon,
  FunctionSquareIcon,
  SigmaIcon,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext } from "react";

import { useI18n } from "@/components/app-providers";
import {
  AggregateTable,
  formatValue,
} from "@/components/ontology/object-viewer";
import type { Source, SourceKind } from "@/lib/agent/types";
import { guessLang } from "@/lib/cjk";
import { cn } from "@/lib/utils";

export type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export const isToolPart = (part: { type: string }): part is ToolPart =>
  part.type.startsWith("tool-");

/** Sources of the conversation (by citation number) and the source opener. */
export const SourcesContext = createContext<{
  sources: Map<number, Source>;
  open: (source: Source) => void;
}>({ sources: new Map(), open: () => undefined });

export const useSources = () => useContext(SourcesContext);

const KIND_ICONS: Record<SourceKind, LucideIcon> = {
  doc: FileTextIcon,
  object: BoxIcon,
  aggregate: SigmaIcon,
  function: FunctionSquareIcon,
};

export function SourceIcon({
  source,
  className,
}: {
  source: Source;
  className?: string;
}) {
  const Icon = KIND_ICONS[source.kind ?? "doc"];
  return <Icon className={cn("size-3.5 shrink-0", className)} />;
}

export const sourceTitle = (source: Source) =>
  source.title || source.path || String(source.primaryKey ?? source.ref);

/** Where a source comes from: KB · path, or ontology · type · key. */
export function sourceOrigin(source: Source) {
  switch (source.kind) {
    case "object":
      return [source.ontologyName, source.objectTypeName, source.primaryKey]
        .filter((item) => item !== undefined && item !== "")
        .join(" · ");
    case "aggregate":
    case "function":
      return [source.ontologyName, source.objectTypeName]
        .filter(Boolean)
        .join(" · ");
    default:
      return [source.kb, source.path].filter(Boolean).join(" · ");
  }
}

/** Popover body for a citation. */
export function SourceCard({ source }: { source: Source }) {
  const { t } = useI18n();
  const kindLabel =
    source.kind === "object"
      ? t("onto.kind.object")
      : source.kind === "aggregate"
        ? t("onto.kind.aggregate")
        : source.kind === "function"
          ? t("onto.kind.function")
          : null;
  return (
    <div
      className="flex flex-col gap-1"
      lang={guessLang(`${source.title ?? ""}${source.snippet ?? ""}`)}
    >
      <p className="text-muted-foreground flex items-center gap-1 truncate text-[11px]">
        <SourceIcon source={source} className="size-3" />
        {kindLabel ? <span>{kindLabel} ·</span> : null}
        <span className="truncate">{sourceOrigin(source)}</span>
      </p>
      <p className="font-medium">{sourceTitle(source)}</p>
      {source.heading ? (
        <p className="text-muted-foreground text-xs">{source.heading}</p>
      ) : null}
      {source.kind === "object" && source.properties ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          {Object.entries(source.properties)
            .slice(0, 8)
            .map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground font-mono">{key}</dt>
                <dd className="truncate">{formatValue(value)}</dd>
              </div>
            ))}
        </dl>
      ) : source.kind === "aggregate" && source.table ? (
        <AggregateTable
          table={{
            ...source.table,
            rows: source.table.rows.slice(0, 6),
            truncated: source.table.rows.length > 6,
          }}
        />
      ) : source.snippet ? (
        <p className="text-muted-foreground line-clamp-6 text-xs leading-relaxed">
          {source.snippet}
        </p>
      ) : null}
    </div>
  );
}

/** A numbered source in a list. */
export function SourceRow({ source }: { source: Source }) {
  const { open } = useSources();
  return (
    <li
      className="flex gap-2"
      lang={guessLang(`${source.title ?? ""}${source.snippet ?? ""}`)}
    >
      <span className="bg-muted text-muted-foreground mt-px flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
        {source.n}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left font-medium underline-offset-3 hover:underline"
          onClick={() => open(source)}
        >
          {source.kind && source.kind !== "doc" ? (
            <SourceIcon source={source} className="text-muted-foreground" />
          ) : null}
          {sourceTitle(source)}
        </button>
        <span className="text-muted-foreground truncate">
          {[sourceOrigin(source), source.kind === "doc" ? source.heading : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {source.snippet ? (
          <span className="text-muted-foreground line-clamp-2">
            {source.snippet}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** A cited source as a tile under an answer. */
export function SourceTile({ source }: { source: Source }) {
  const { open } = useSources();
  return (
    <li>
      <button
        type="button"
        onClick={() => open(source)}
        className="hover:bg-muted/60 flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors"
        lang={guessLang(source.title ?? "")}
      >
        <span className="bg-primary/10 text-primary mt-px flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
          {source.n}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1 truncate font-medium">
            {source.kind && source.kind !== "doc" ? (
              <SourceIcon source={source} className="text-muted-foreground" />
            ) : null}
            <span className="truncate">{sourceTitle(source)}</span>
          </span>
          <span className="text-muted-foreground truncate">
            {sourceOrigin(source)}
          </span>
        </span>
      </button>
    </li>
  );
}

/** A clickable citation number in running text. */
export function CitationChip({ n }: { n: number }) {
  const { sources, open } = useSources();
  const source = sources.get(n);
  return (
    <button
      type="button"
      disabled={!source}
      onClick={() => source && open(source)}
      className="bg-primary/10 text-primary hover:bg-primary/20 mx-px inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 align-middle text-[11px] font-semibold tabular-nums disabled:opacity-50"
    >
      {n}
    </button>
  );
}

const INLINE_CITATION = /\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\](?!\()/g;

/** Plain text whose [n] citations become clickable chips. */
export function TextWithCitations({ text }: { text: string }) {
  const { sources } = useSources();
  const parts: (string | number)[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_CITATION)) {
    const numbers = match[1]
      .split(/\s*[,，、]\s*/)
      .map(Number)
      .filter((n) => sources.has(n));
    if (!numbers.length) continue;
    parts.push(text.slice(last, match.index), ...numbers);
    last = (match.index ?? 0) + match[0].length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "number" ? <CitationChip key={index} n={part} /> : part,
      )}
    </>
  );
}
