"use client";

import {
  CircleAlertIcon,
  DownloadIcon,
  EyeIcon,
  FolderSyncIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { JobProgress } from "@/components/job-progress";
import { KbCreateDialog, startKbSync } from "@/components/kb-form";
import { EmptyState, Page, RequireIndex, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody } from "@/lib/client";
import type { KbSummary } from "@/lib/kb/types";
import { formatRelative } from "@/lib/format";
import { SAMPLE_DATASETS } from "@/lib/samples";

export const kbHref = (id: string) => `/kb/${encodeURIComponent(id)}`;

/** Badge describing where a knowledge base's content comes from. */
export function KbTypeBadge({
  kb,
}: {
  kb: Pick<KbSummary, "config" | "chunked">;
}) {
  const { t } = useI18n();
  if (kb.config?.source.type === "directory") {
    return (
      <Badge variant="outline">
        <FolderSyncIcon />
        {t("kb.type.directory")}
      </Badge>
    );
  }
  if (kb.config?.source.type === "managed") {
    return (
      <Badge variant="outline">
        <UploadIcon />
        {t("kb.type.managed")}
      </Badge>
    );
  }
  return <Badge variant="outline">{t("kb.type.plain")}</Badge>;
}

function KbCard({ kb }: { kb: KbSummary }) {
  const { t, lang } = useI18n();
  const { refreshKbs } = useWorkspace();
  const [starting, setStarting] = useState(false);
  const running = kb.job?.status === "running" || kb.job?.status === "queued";

  const sync = async () => {
    setStarting(true);
    const job = await startKbSync(kb.id, {}, (message) =>
      toast.add({
        title: t("common.error"),
        description: message,
        type: "error",
      }),
    );
    setStarting(false);
    if (job) await refreshKbs();
  };

  return (
    <li className="bg-card ring-foreground/10 flex min-w-0 flex-col gap-3 rounded-xl p-4 ring-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={kbHref(kb.id)}
            className="truncate font-medium underline-offset-3 hover:underline"
          >
            {kb.name}
          </Link>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {kb.indexUid}
          </span>
        </div>
        <KbTypeBadge kb={kb} />
      </div>
      {kb.description ? (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {kb.description}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="secondary">
          {kb.chunked
            ? t("kb.chunks", { count: kb.documents })
            : t("kb.records", { count: kb.documents })}
        </Badge>
        {kb.vector ? (
          <Badge variant="success">
            {t("kb.vector", { dims: kb.vector.dimensions })}
          </Badge>
        ) : null}
        {kb.embedders.map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
        {kb.config?.source.type === "directory" && kb.config.source.watch ? (
          <Badge variant="outline">
            <EyeIcon />
            {t("kb.watching")}
          </Badge>
        ) : null}
        {kb.isIndexing && !running ? (
          <Badge variant="warning">
            <Spinner className="size-3" />
            {t("data.indexing")}
          </Badge>
        ) : null}
      </div>
      {!running && kb.lastSync ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span title={new Date(kb.lastSync.finishedAt).toLocaleString()}>
            {t("kb.lastSyncShort", {
              time: formatRelative(kb.lastSync.finishedAt, lang),
            })}
          </span>
          <span>{t("kb.files", { count: kb.lastSync.files })}</span>
          {kb.lastSync.failed ? (
            <Link
              href={kbHref(kb.id)}
              className="text-destructive underline-offset-3 hover:underline"
            >
              {t("kb.failedShort", { count: kb.lastSync.failed })}
            </Link>
          ) : null}
        </p>
      ) : null}
      {running && kb.job ? <JobProgress job={kb.job} compact /> : null}
      {!running && kb.job?.status === "failed" ? (
        <p className="text-destructive flex items-start gap-1.5 text-xs">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-2">
            {t("kb.job.failed", { message: kb.job.message ?? "" })}
          </span>
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href={kbHref(kb.id)} />}
        >
          {t("kb.open")}
        </Button>
        {kb.config ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={starting || running}
            onClick={() => void sync()}
          >
            {starting || running ? <Spinner /> : <RefreshCwIcon />}
            {t("kb.sync")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function Samples() {
  const { t } = useI18n();
  const { refreshKbs, setKbId } = useWorkspace();
  const [loading, setLoading] = useState<string | null>(null);

  const load = async (id: string) => {
    setLoading(id);
    try {
      const result = await api<{
        kbId: string;
        uid: string;
        documents: number;
      }>("/api/samples", { method: "POST", body: jsonBody({ dataset: id }) });
      await refreshKbs();
      setKbId(result.kbId);
      toast.add({
        title: t("task.succeeded"),
        description: t("data.samples.done", {
          count: result.documents,
          uid: result.uid,
        }),
      });
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <Section title={t("data.samples")} description={t("data.samples.desc")}>
      <div className="grid gap-2 sm:grid-cols-3">
        {SAMPLE_DATASETS.map((dataset) => (
          <div
            key={dataset.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {dataset.label}
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {dataset.indexUid} · {dataset.documents.length}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loading !== null}
              aria-label={`${t("data.samples.import")} ${dataset.label}`}
              onClick={() => void load(dataset.id)}
            >
              {loading === dataset.id ? <Spinner /> : <DownloadIcon />}
              {t("data.samples.import")}
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

type SortKey = "name" | "size" | "recent";

const SORTERS: Record<SortKey, (a: KbSummary, b: KbSummary) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => b.documents - a.documents,
  recent: (a, b) =>
    (b.lastSync?.finishedAt ?? "").localeCompare(a.lastSync?.finishedAt ?? ""),
};

export function KbListView() {
  const { t } = useI18n();
  const { status, kbs, connections, refreshKbs } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const offline = status !== null && !status.meilisearch.ok;
  const needle = filter.trim().toLowerCase();
  const visible = (kbs ?? [])
    .filter(
      (kb) =>
        !needle ||
        [kb.name, kb.indexUid, kb.description].some((text) =>
          text.toLowerCase().includes(needle),
        ),
    )
    .sort(SORTERS[sort]);

  return (
    <Page
      title={t("kb.title")}
      description={t("kb.desc")}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.refresh")}
            onClick={() => void refreshKbs()}
          >
            <RefreshCwIcon />
          </Button>
          <Button disabled={offline} onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("kb.create")}
          </Button>
        </>
      }
    >
      {offline ? (
        <RequireIndex>{null}</RequireIndex>
      ) : kbs === null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      ) : (
        <>
          {kbs.length > 3 ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={filter}
                  placeholder={t("kb.search")}
                  aria-label={t("kb.search")}
                  className="pl-8"
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
              <Segmented<SortKey>
                size="sm"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "name", label: t("kb.sort.name") },
                  { value: "recent", label: t("kb.sort.recent") },
                  { value: "size", label: t("kb.sort.size") },
                ]}
              />
            </div>
          ) : null}
          {needle && !visible.length ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("kb.noMatch")}
            </p>
          ) : null}
          {connections.map((connection) => {
            const items = visible.filter(
              (kb) => kb.connectionId === connection.id,
            );
            if (!connection.ok) {
              return (
                <p
                  key={connection.id}
                  className="text-destructive flex items-start gap-1.5 text-sm"
                >
                  <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="wrap-break-word">
                    {connection.name} · {t("conn.down")}: {connection.error}
                  </span>
                </p>
              );
            }
            if (!items.length && (connections.length > 1 || needle))
              return null;
            return (
              <div key={connection.id} className="flex flex-col gap-2">
                {connections.length > 1 ? (
                  <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                    {connection.name}
                    <span className="font-mono text-xs font-normal">
                      {connection.host}
                    </span>
                  </h2>
                ) : null}
                {items.length ? (
                  <ul className="grid gap-3 md:grid-cols-2">
                    {items.map((kb) => (
                      <KbCard key={kb.id} kb={kb} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title={t("empty.noIndex.title")}
                    description={t("kb.empty")}
                    action={
                      <Button onClick={() => setCreating(true)}>
                        <PlusIcon />
                        {t("kb.create")}
                      </Button>
                    }
                  />
                )}
              </div>
            );
          })}
          <Samples />
        </>
      )}
      <KbCreateDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
