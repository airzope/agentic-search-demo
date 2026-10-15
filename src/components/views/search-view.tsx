"use client";

import {
  ChevronDownIcon,
  CircleAlertIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { DocDialog } from "@/components/doc-dialog";
import { Highlight } from "@/components/highlight";
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
import { fieldText } from "@/lib/display";
import type { SearchHit, SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

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

function SearchBody() {
  const { t } = useI18n();
  const { indexUid, detail, prefs } = useWorkspace();
  const { input, query, inputProps, clear } = useImeQuery();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [filterExpr, setFilterExpr] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [page, setPage] = useState({ key: "", offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SearchHit | null>(null);

  const display = detail?.display ?? {};
  const facets = useMemo(
    () =>
      (detail?.settings.filterableAttributes ?? [])
        .filter(
          (attribute): attribute is string => typeof attribute === "string",
        )
        .slice(0, MAX_FACETS),
    [detail],
  );

  // Reset filters when switching index.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per index
    setSelected({});
    setFilterExpr("");
  }, [indexUid]);

  const filter = useMemo(() => {
    const parts: (string | string[])[] = Object.entries(selected)
      .filter(([, values]) => values.length)
      .map(([attribute, values]) =>
        values.map((value) => `${attribute} = "${escapeFilterValue(value)}"`),
      );
    if (filterExpr.trim()) parts.push(filterExpr.trim());
    return parts;
  }, [selected, filterExpr]);

  const requestKey = JSON.stringify([indexUid, query, prefs, filter, facets]);
  // A new query starts from the first page.
  const offset = page.key === requestKey ? page.offset : 0;

  useEffect(() => {
    if (!indexUid || !detail) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the request below
    setLoading(true);
    api<SearchResult>("/api/search", {
      method: "POST",
      signal: controller.signal,
      body: jsonBody({
        indexUid,
        q: query,
        ...prefs,
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
  }, [requestKey, offset, detail]);

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

  const titleOf = (hit: SearchHit) =>
    display.title
      ? fieldText(hit._formatted?.[display.title] ?? hit[display.title])
      : "";
  const snippetOf = (hit: SearchHit) =>
    display.content
      ? fieldText(hit._formatted?.[display.content] ?? hit[display.content])
      : "";
  const primaryKey = detail?.primaryKey ?? "id";
  const hasFilters = filter.length > 0;

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

      {result ? (
        <p className="text-muted-foreground text-xs">
          {t("search.stats", {
            count: result.estimatedTotalHits ?? hits.length,
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
        {hits.map((hit, index) => {
          const title = titleOf(hit);
          const snippet = snippetOf(hit);
          const extra = Object.entries(hit)
            .filter(
              ([key, value]) =>
                !key.startsWith("_") &&
                ![display.title, display.content, primaryKey].includes(key) &&
                fieldText(value).length <= 40 &&
                fieldText(value).length > 0,
            )
            .slice(0, 4);
          return (
            <li key={`${fieldText(hit[primaryKey])}-${index}`}>
              <button
                type="button"
                onClick={() => setOpened(hit)}
                className="bg-card ring-foreground/10 hover:ring-foreground/25 focus-visible:ring-ring flex w-full flex-col gap-1.5 rounded-xl p-3.5 text-left ring-1 transition-shadow outline-none focus-visible:ring-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <Highlight
                    value={title || `#${fieldText(hit[primaryKey])}`}
                    className="font-medium"
                  />
                  {typeof hit._rankingScore === "number" ? (
                    <span
                      className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
                      title={t("search.score")}
                    >
                      {hit._rankingScore.toFixed(3)}
                    </span>
                  ) : null}
                </div>
                {snippet ? (
                  <Highlight
                    as="p"
                    value={snippet}
                    className="text-muted-foreground line-clamp-3 text-sm leading-relaxed"
                  />
                ) : null}
                {extra.length ? (
                  <div className="flex flex-wrap gap-1">
                    {extra.map(([key, value]) => (
                      <Badge
                        key={key}
                        variant="outline"
                        className="font-normal"
                      >
                        <span className="opacity-60">{key}</span>
                        {fieldText(value)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      {result && hits.length < (result.estimatedTotalHits ?? 0) ? (
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

      <DocDialog
        hit={opened}
        title={opened ? stripHighlights(titleOf(opened)) : ""}
        onOpenChange={(open) => !open && setOpened(null)}
      />
    </div>
  );
}

export function SearchView() {
  const { t } = useI18n();
  return (
    <Page title={t("nav.search")}>
      <RequireIndex>
        <SearchBody />
      </RequireIndex>
    </Page>
  );
}
