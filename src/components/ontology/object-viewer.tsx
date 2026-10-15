"use client";

import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LinkIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/components/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Source } from "@/lib/agent/types";
import { guessLang } from "@/lib/cjk";
import { api, errorMessage, jsonBody } from "@/lib/client";
import {
  foundryObjectUrl,
  type ObjectPage,
  type ObjectTypeDetail,
  type OntologyObject,
  type PublicOntology,
} from "@/lib/ontology/types";
import { cn } from "@/lib/utils";

export const ontologyPath = (id: string) =>
  `/api/ontology/${encodeURIComponent(id)}`;

/** A value as short readable text. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The OSDK call behind a source, with when it ran. */
export function Provenance({ source }: { source: Source }) {
  const { t } = useI18n();
  if (!source.query) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">{t("onto.query")}</span>
        {source.at ? (
          <span>
            {t("onto.retrievedAt", {
              time: new Date(source.at).toLocaleString(),
            })}
          </span>
        ) : null}
      </p>
      <pre className="bg-muted overflow-x-auto rounded-md p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
        {source.query}
      </pre>
    </div>
  );
}

/** Aggregation result table. */
export function AggregateTable({
  table,
}: {
  table: NonNullable<Source["table"]>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-muted/60 sticky top-0">
            <tr>
              {table.columns.map((column) => (
                <th key={column} className="px-2 py-1.5 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className="border-t">
                {row.map((cell, at) => (
                  <td
                    key={at}
                    className={cn(
                      "px-2 py-1.5",
                      typeof cell === "number" && "text-right tabular-nums",
                    )}
                  >
                    {formatValue(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.truncated ? (
        <p className="text-muted-foreground text-xs">
          {t("onto.truncated", { count: table.rows.length })}
        </p>
      ) : null}
    </div>
  );
}

export type ObjectTarget = {
  ontology: string;
  objectType: string;
  primaryKey: string | number;
  /** The cited snapshot, when opened from an answer. */
  source?: Source;
};

type Live = {
  type: ObjectTypeDetail;
  object: OntologyObject | null;
  error?: string;
};

function ObjectBody({
  target,
  baseUrl,
  onNavigate,
}: {
  target: ObjectTarget;
  baseUrl?: string;
  onNavigate: (next: ObjectTarget) => void;
}) {
  const { t } = useI18n();
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<
    Record<string, OntologyObject[] | "loading" | { error: string }>
  >({});

  useEffect(() => {
    let cancelled = false;
    setLive(null);
    setError(null);
    setLinks({});
    const base = ontologyPath(target.ontology);
    Promise.all([
      api<ObjectTypeDetail>(
        `${base}/object-types/${encodeURIComponent(target.objectType)}`,
      ),
      api<ObjectPage>(`${base}/objects`, {
        method: "POST",
        body: jsonBody({
          objectType: target.objectType,
          primaryKeys: [target.primaryKey],
          limit: 1,
        }),
      }).catch((reason) => ({ error: errorMessage(reason) })),
    ])
      .then(([type, page]) => {
        if (cancelled) return;
        setLive(
          "error" in page
            ? { type, object: null, error: page.error }
            : { type, object: page.objects[0] ?? null },
        );
      })
      .catch((reason) => !cancelled && setError(errorMessage(reason)));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const loadLink = async (link: string) => {
    setLinks((current) => ({ ...current, [link]: "loading" }));
    try {
      const page = await api<{ objects: OntologyObject[] }>(
        `${ontologyPath(target.ontology)}/links`,
        {
          method: "POST",
          body: jsonBody({
            objectType: target.objectType,
            primaryKey: target.primaryKey,
            link,
            limit: 50,
          }),
        },
      );
      setLinks((current) => ({ ...current, [link]: page.objects }));
    } catch (reason) {
      setLinks((current) => ({
        ...current,
        [link]: { error: errorMessage(reason) },
      }));
    }
  };

  const snapshot = target.source?.properties;
  const current = live?.object?.properties;
  const keys = live
    ? live.type.properties.map((property) => property.apiName)
    : Object.keys(snapshot ?? {});
  // Compare every property the snapshot covered (absent ones were null).
  const covered = target.source?.fields ?? Object.keys(snapshot ?? {});
  const changed =
    snapshot && current
      ? covered.filter((key) => !same(snapshot[key], current[key]))
      : [];
  const labels = new Map(
    (live?.type.properties ?? []).map((property) => [
      property.apiName,
      property.displayName || property.apiName,
    ]),
  );
  const url =
    target.source?.url ||
    (baseUrl ? foundryObjectUrl(baseUrl, live?.object?.rid) : "");

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {snapshot ? (
        !live ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Spinner /> {t("onto.liveChecking")}
          </p>
        ) : live.error ? (
          <p className="text-destructive flex items-center gap-1.5 text-xs">
            <CircleAlertIcon className="size-3.5" />
            {t("onto.liveError", { error: live.error })}
          </p>
        ) : changed.length ? (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <CircleAlertIcon className="size-3.5" />
            {t("onto.liveDiff", { count: changed.length })}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2Icon className="size-3.5" />
            {t("onto.liveSame")}
          </p>
        )
      ) : !live && !error ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Spinner /> {t("common.loading")}
        </p>
      ) : null}

      {keys.length ? (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {keys.map((key) => {
                const value = current ? current[key] : snapshot?.[key];
                const differs = changed.includes(key);
                return (
                  <tr key={key} className="border-b last:border-b-0">
                    <th className="bg-muted/40 w-2/5 px-2.5 py-1.5 align-top font-normal">
                      <span className="block text-xs">
                        {labels.get(key) ?? key}
                      </span>
                      <span className="text-muted-foreground block font-mono text-[10px]">
                        {key}
                      </span>
                    </th>
                    <td
                      className="px-2.5 py-1.5 align-top break-all"
                      lang={guessLang(String(value ?? ""))}
                    >
                      <span className={cn(differs && "font-medium")}>
                        {formatValue(value)}
                      </span>
                      {differs ? (
                        <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
                          {t("onto.snapshot")}: {formatValue(snapshot?.[key])}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {live?.type.links.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("onto.links")}</p>
          <ul className="flex flex-col gap-2">
            {live.type.links.map((link) => {
              const state = links[link.apiName];
              return (
                <li key={link.apiName} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm">
                      <LinkIcon className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="truncate">
                        {link.displayName}
                        <span className="text-muted-foreground font-mono text-xs">
                          {" "}
                          → {link.target} · {link.cardinality}
                        </span>
                      </span>
                    </span>
                    {state === undefined ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void loadLink(link.apiName)}
                      >
                        {t("onto.loadLinks")}
                      </Button>
                    ) : state === "loading" ? (
                      <Spinner />
                    ) : null}
                  </div>
                  {state && state !== "loading" && "error" in state ? (
                    <p className="text-destructive mt-1 text-xs">
                      {state.error}
                    </p>
                  ) : null}
                  {Array.isArray(state) ? (
                    state.length ? (
                      <ul className="mt-1.5 flex flex-col">
                        {state.map((object) => (
                          <li key={String(object.primaryKey)}>
                            <button
                              type="button"
                              className="hover:bg-muted flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs"
                              onClick={() =>
                                onNavigate({
                                  ontology: target.ontology,
                                  objectType: link.target,
                                  primaryKey: object.primaryKey,
                                })
                              }
                            >
                              <span className="text-muted-foreground shrink-0 font-mono">
                                {String(object.primaryKey)}
                              </span>
                              <span
                                className="truncate"
                                lang={guessLang(object.title ?? "")}
                              >
                                {object.title}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("onto.type.noObjects")}
                      </p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {target.source ? <Provenance source={target.source} /> : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm underline-offset-3 hover:underline"
        >
          <ExternalLinkIcon className="size-3.5" />
          {t("onto.openFoundry")}
        </a>
      ) : null}
    </div>
  );
}

/**
 * Ontology source viewer: an object (cited snapshot compared with current
 * Foundry data, links to follow), or an aggregation / function result with
 * the OSDK call that produced it.
 */
export function OntologyViewer({
  source,
  object,
  ontologies,
  onClose,
}: {
  source: Source | null;
  object?: ObjectTarget | null;
  ontologies?: PublicOntology[] | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const initial: ObjectTarget | null =
    object ??
    (source?.kind === "object" && source.ontology && source.objectType
      ? {
          ontology: source.ontology,
          objectType: source.objectType,
          primaryKey: source.primaryKey ?? "",
          source,
        }
      : null);
  const [stack, setStack] = useState<ObjectTarget[]>([]);
  const [opened, setOpened] = useState<unknown>(null);
  // Reset navigation when a different item is opened.
  const key = source ?? object ?? null;
  if (key !== opened) {
    setOpened(key);
    setStack(initial ? [initial] : []);
  }
  const current = stack.at(-1) ?? null;
  const open = Boolean(source || object);
  const connection = ontologies?.find((item) => item.id === current?.ontology);
  const ontologyName = source?.ontologyName ?? connection?.name;

  const kindLabel =
    source?.kind === "aggregate"
      ? t("onto.kind.aggregate")
      : source?.kind === "function"
        ? t("onto.kind.function")
        : t("onto.kind.object");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle
          className="flex items-center gap-2"
          lang={guessLang(source?.title ?? "")}
        >
          {stack.length > 1 ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Back"
              onClick={() => setStack(stack.slice(0, -1))}
            >
              <ArrowLeftIcon />
            </Button>
          ) : null}
          <span className="truncate">
            {stack.length > 1
              ? String(current?.primaryKey ?? "")
              : (source?.title ?? String(current?.primaryKey ?? ""))}
          </span>
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline">{kindLabel}</Badge>
          <span>
            {[
              ontologyName,
              (stack.length <= 1 && source?.objectTypeName) ||
                current?.objectType,
              current ? String(current.primaryKey) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </DialogDescription>
        <div className="-mx-1 max-h-[65svh] overflow-y-auto px-1">
          {current ? (
            <ObjectBody
              key={`${current.ontology}|${current.objectType}|${current.primaryKey}`}
              target={current}
              baseUrl={connection?.baseUrl}
              onNavigate={(next) => setStack([...stack, next])}
            />
          ) : source?.kind === "aggregate" && source.table ? (
            <div className="flex flex-col gap-4">
              <AggregateTable table={source.table} />
              <Provenance source={source} />
            </div>
          ) : source?.kind === "function" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs font-medium">
                  {t("onto.value")}
                </p>
                <pre className="bg-muted max-h-72 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
                  {JSON.stringify(source.value, null, 2)}
                </pre>
              </div>
              <Provenance source={source} />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
