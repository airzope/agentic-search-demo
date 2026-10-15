"use client";

import {
  ChevronDownIcon,
  CircleAlertIcon,
  FolderIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { kbPath, useI18n, useWorkspace } from "@/components/app-providers";
import { DocViewer, type DocTarget } from "@/components/doc-viewer";
import { Highlight } from "@/components/highlight";
import { KbScopePicker } from "@/components/kb-scope";
import { EmptyState, Page, RequireIndex } from "@/components/page";
import { SearchControls } from "@/components/search-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { stripHighlights } from "@/lib/cjk";
import { api, errorMessage, jsonBody } from "@/lib/client";
import type { KbHit, RetrieveResult } from "@/lib/kb/retrieve";
import type { KbDetail, TreeNode } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

type SearchResponse = RetrieveResult;

const PAGE_SIZE = 20;
const MAX_FACETS = 3;

const escapeFilterValue = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

/** Keep the value of the search box, but only "commit" it outside IME composition. */
function useImeQuery(delay = 220) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const composing = useRef(false);

  useEffect(() => {
    if (composing.current) return;
    const timer = setTimeout(() => setQuery(input), delay);
    return () => clearTimeout(timer);
  }, [input, delay]);

  return {
    input,
    query,
    inputProps: {
      value: input,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setInput(event.target.value),
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => {
        composing.current = false;
        setInput(event.currentTarget.value);
      },
    },
    clear: () => {
      setInput("");
      setQuery("");
    },
  };
}

type TreeLevel = { children: TreeNode[] };

/** Settings of the knowledge base when exactly one is in scope (for facets). */
function useSingleDetail(id: string | null) {
  const [detail, setDetail] = useState<KbDetail | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<KbDetail>(kbPath(id))
      .then((next) => active && setDetail(next))
      .catch(() => active && setDetail(null));
    return () => {
      active = false;
    };
  }, [id]);
  return id && detail?.id === id ? detail : null;
}

/** Sub-folders of `branch` in the first chunked knowledge base of the scope. */
function useBranchOptions(kbId: string | null, branch: string) {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!kbId) return;
    let active = true;
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    api<TreeLevel>(`${kbPath(kbId)}/tree${query}`)
      .then(
        (level) =>
          active && setOptions(level.children.map((node) => node.branch)),
      )
      .catch(() => active && setOptions([]));
    return () => {
      active = false;
    };
  }, [kbId, branch]);
  return kbId ? options : [];
}

function SearchBody({ initialBranch }: { initialBranch: string | null }) {
  const { t } = useI18n();
  const { kbs, scope, prefs } = useWorkspace();
  const { input, query, inputProps, clear } = useImeQuery();
  const [branch, setBranch] = useState(initialBranch ?? "");
  const [branchInput, setBranchInput] = useState(initialBranch ?? "");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [filterExpr, setFilterExpr] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [hits, setHits] = useState<KbHit[]>([]);
  const [page, setPage] = useState({ key: "", offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<DocTarget | null>(null);

  const scopeKbs = useMemo(
    () => (kbs ?? []).filter((kb) => scope.includes(kb.id)),
    [kbs, scope],
  );
  const single = scopeKbs.length === 1 ? scopeKbs[0] : null;
  const detail = useSingleDetail(single?.id ?? null);
  const chunkedKb = scopeKbs.find((kb) => kb.chunked) ?? null;
  const branchOptions = useBranchOptions(chunkedKb?.id ?? null, branch);

  const facets = useMemo(() => {
    if (!single) return [];
    if (single.chunked) return ["file_type"];
    return (detail?.settings.filterableAttributes ?? [])
      .filter((attribute): attribute is string => typeof attribute === "string")
      .slice(0, MAX_FACETS);
  }, [single, detail]);

  // Filters only make sense for one knowledge base.
  const scopeKey = scope.join(",");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per scope
    setSelected({});
    setFilterExpr("");
  }, [scopeKey]);

  const filter = useMemo(() => {
    if (!single) return [];
    const parts: (string | string[])[] = Object.entries(selected)
      .filter(([, values]) => values.length)
      .map(([attribute, values]) =>
        values.map((value) => `${attribute} = "${escapeFilterValue(value)}"`),
      );
    if (filterExpr.trim()) parts.push(filterExpr.trim());
    return parts;
  }, [single, selected, filterExpr]);

  const requestKey = JSON.stringify([
    scope,
    query,
    prefs,
    branch,
    filter,
    facets,
  ]);
  // A new query starts from the first page.
  const offset = page.key === requestKey ? page.offset : 0;

  useEffect(() => {
    if (!scope.length) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the request below
    setLoading(true);
    api<SearchResponse>("/api/search", {
      method: "POST",
      signal: controller.signal,
      body: jsonBody({
        kbs: scope,
        q: query,
        ...prefs,
        branch: chunkedKb && branch ? branch : null,
        filter,
        facets,
        limit: PAGE_SIZE,
        offset,
      }),
    })
      .then((next) => {
        setResult(next);
        setHits((current) =>
          offset === 0 ? next.hits : [...current, ...next.hits],
        );
        setError(null);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(reason));
        setResult(null);
        setHits([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // `requestKey` captures every input except `offset`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, offset]);

  const toggleFacet = (attribute: string, value: string) =>
    setSelected((current) => {
      const values = current[attribute] ?? [];
      return {
        ...current,
        [attribute]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });

  const commitBranch = (value: string) => {
    const next = value.trim().replace(/^\/+|\/+$/g, "");
    setBranchInput(next);
    setBranch(next);
  };
  const hasFilters = filter.length > 0;
  const notices = [
    ...(result?.warnings ?? []),
    ...(result?.errors ?? []).map((item) => `${item.scope}: ${item.message}`),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            {...inputProps}
            autoFocus
            type="search"
            enterKeyHint="search"
            placeholder={t("search.placeholder")}
            aria-label={t("nav.search")}
            className="h-11 rounded-xl pr-10 pl-9 text-base md:text-base [&::-webkit-search-cancel-button]:appearance-none"
          />
          {loading ? (
            <Spinner className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2" />
          ) : input ? (
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={clear}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <KbScopePicker />
          {chunkedKb ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                commitBranch(branchInput);
              }}
            >
              <FolderIcon className="text-muted-foreground size-4 shrink-0" />
              <Input
                aria-label={t("search.branch")}
                list="search-branches"
                value={branchInput}
                placeholder={t("search.allBranches")}
                onChange={(event) => {
                  setBranchInput(event.target.value);
                  // Picking a datalist suggestion applies it right away.
                  if (branchOptions.includes(event.target.value))
                    commitBranch(event.target.value);
                }}
                onBlur={() => commitBranch(branchInput)}
                className="h-8 w-48 text-sm"
              />
              <datalist id="search-branches">
                {branchOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              {branch ? (
                <button
                  type="button"
                  aria-label={t("search.allBranches")}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => commitBranch("")}
                >
                  <XIcon className="size-4" />
                </button>
              ) : null}
            </form>
          ) : null}
        </div>
        <SearchControls />
      </div>

      {facets.length || hasFilters ? (
        <div className="flex flex-col gap-2">
          {facets.map((attribute) => {
            const distribution = result?.facetDistribution?.[attribute] ?? {};
            const values = Object.entries(distribution)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12);
            const chosen = selected[attribute] ?? [];
            // Keep selected values visible even if they have no hits now.
            for (const value of chosen) {
              if (!values.some(([item]) => item === value))
                values.push([value, 0]);
            }
            if (!values.length) return null;
            return (
              <div
                key={attribute}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="text-muted-foreground w-20 shrink-0 truncate font-mono text-xs">
                  {attribute}
                </span>
                {values.map(([value, count]) => {
                  const active = chosen.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleFacet(attribute, value)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
                        active
                          ? "bg-primary text-primary-foreground border-transparent"
                          : "hover:bg-muted",
                      )}
                    >
                      <span>{value}</span>
                      <span className="tabular-nums opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <Collapsible className="group">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
                {t("search.filterExpr")}
                <ChevronDownIcon className="size-3.5 transition-transform group-data-open:rotate-180" />
              </CollapsibleTrigger>
              {hasFilters ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3"
                  onClick={() => {
                    setSelected({});
                    setFilterExpr("");
                  }}
                >
                  {t("search.clearFilters")}
                </button>
              ) : null}
            </div>
            <CollapsibleContent className="pt-2">
              <Input
                value={filterExpr}
                onChange={(event) => setFilterExpr(event.target.value)}
                placeholder={t("search.filterExpr.placeholder")}
                className="font-mono text-xs md:text-xs"
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border p-3 text-sm"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span className="wrap-break-word">{error}</span>
        </div>
      ) : null}

      {notices.length ? (
        <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
          {notices.map((notice) => (
            <li key={notice} className="flex items-start gap-1.5">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="wrap-break-word">{notice}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {result ? (
        <p className="text-muted-foreground text-xs">
          {t("search.stats", {
            count: result.estimatedTotalHits,
            ms: result.processingTimeMs,
          })}
          {typeof result.semanticHitCount === "number"
            ? ` · ${t("search.semanticHits", { count: result.semanticHitCount })}`
            : null}
        </p>
      ) : null}

      {result && !hits.length && !error ? (
        <EmptyState icon={SearchXIcon} title={t("search.noResults")} />
      ) : null}

      <ol className="flex flex-col gap-2">
        {hits.map((hit, index) => (
          <li key={`${hit.ref}-${index}`}>
            <button
              type="button"
              onClick={() =>
                setOpened({
                  kbId: hit.kbId,
                  docId: hit.docId,
                  chunk: hit.chunkIndex,
                  title: stripHighlights(hit.titleHighlighted || hit.title),
                })
              }
              className="bg-card ring-foreground/10 hover:ring-foreground/25 focus-visible:ring-ring flex w-full flex-col gap-1.5 rounded-xl p-3.5 text-left ring-1 transition-shadow outline-none focus-visible:ring-2"
            >
              <div className="flex items-start justify-between gap-3">
                <Highlight
                  value={hit.titleHighlighted || hit.title || `#${hit.id}`}
                  className="font-medium"
                />
                <span
                  className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
                  title={t("search.score")}
                >
                  {hit.score.toFixed(3)}
                </span>
              </div>
              {hit.path || scope.length > 1 ? (
                <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
                  {scope.length > 1 ? (
                    <Badge variant="outline" className="font-normal">
                      {hit.kbName}
                    </Badge>
                  ) : null}
                  {hit.path ? (
                    <span className="truncate font-mono">{hit.path}</span>
                  ) : null}
                  {hit.heading ? (
                    <span className="truncate">· {hit.heading}</span>
                  ) : null}
                </div>
              ) : null}
              {hit.snippet ? (
                <Highlight
                  as="p"
                  value={hit.snippet}
                  className="text-muted-foreground line-clamp-3 text-sm leading-relaxed"
                />
              ) : null}
              {Object.keys(hit.fields).length ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(hit.fields).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="font-normal">
                      <span className="opacity-60">{key}</span>
                      {value}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </button>
          </li>
        ))}
      </ol>

      {result && hits.length < result.estimatedTotalHits ? (
        <Button
          variant="outline"
          className="self-center"
          disabled={loading}
          onClick={() => setPage({ key: requestKey, offset: hits.length })}
        >
          {loading ? <Spinner /> : null}
          {t("search.loadMore")}
        </Button>
      ) : null}

      <DocViewer target={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

export function SearchView({
  initialBranch = null,
}: {
  initialBranch?: string | null;
}) {
  const { t } = useI18n();
  return (
    <Page title={t("nav.search")}>
      <RequireIndex>
        <SearchBody initialBranch={initialBranch} />
      </RequireIndex>
    </Page>
  );
}
