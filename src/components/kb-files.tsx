"use client";

import {
  BanIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { kbPath, useI18n, useWorkspace } from "@/components/app-providers";
import type { DocTarget } from "@/components/doc-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";
import { guessLang } from "@/lib/cjk";
import { api, errorMessage, jsonBody } from "@/lib/client";
import { formatBytes, formatRelative } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type { FileListing, FileStatus, KbFile } from "@/lib/kb/files";
import type { KbDetail } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

const PAGE = 100;

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
const SHEET = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv)$/i;
const DOC = /\.(pdf|docx?|pptx?|odt|odp|rtf|epub|md|txt|html?)$/i;

function FileTypeIcon({ name }: { name: string }) {
  const Icon = IMAGE.test(name)
    ? FileImageIcon
    : SHEET.test(name)
      ? FileSpreadsheetIcon
      : DOC.test(name)
        ? FileTextIcon
        : FileIcon;
  return <Icon className="text-muted-foreground size-4 shrink-0" />;
}

const STATUS_VARIANT: Record<
  FileStatus,
  "success" | "destructive" | "outline"
> = {
  ok: "success",
  failed: "destructive",
  skipped: "outline",
};

/** Debounced value that waits for IME composition to end. */
function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Files of an app-managed knowledge base, from its sync manifest: folders,
 * per-file status (indexed / failed / skipped), and per-file actions.
 */
export function FileExplorer({
  detail,
  initialStatus = null,
  onOpenDoc,
  onChanged,
}: {
  detail: KbDetail;
  initialStatus?: FileStatus | null;
  onOpenDoc: (target: DocTarget) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t, lang } = useI18n();
  const { setScope } = useWorkspace();
  const router = useRouter();
  const managed = detail.config?.source.type === "managed";
  const [dir, setDir] = useState("");
  const [status, setStatus] = useState<FileStatus | "all">(
    initialStatus ?? "all",
  );
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const composing = useRef(false);
  const q = useDebounced(committed);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const syncedAt = detail.lastSync?.finishedAt ?? "";

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          dir,
          limit: String(PAGE),
          offset: String(offset),
        });
        if (status !== "all") params.set("status", status);
        if (q.trim()) params.set("q", q.trim());
        const next = await api<FileListing>(
          `${kbPath(detail.id)}/files?${params}`,
        );
        setListing(next);
        setFiles((current) =>
          offset ? [...current, ...next.files] : next.files,
        );
        setError(null);
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
      }
    },
    [detail.id, dir, status, q],
  );

  useEffect(() => {
    // Async loader: state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0);
    setSelected(new Set());
  }, [load, syncedAt]);

  const act = async (
    action: "reprocess" | "delete" | "exclude",
    paths: string[],
  ) => {
    if (!paths.length) return;
    if (
      action === "delete" &&
      !window.confirm(t("files.deleteConfirm", { count: paths.length }))
    )
      return;
    if (
      action === "exclude" &&
      !window.confirm(t("files.excludeConfirm", { count: paths.length }))
    )
      return;
    try {
      if (action === "delete") {
        await api(`${kbPath(detail.id)}/files`, {
          method: "DELETE",
          body: jsonBody({ paths }),
        });
      } else {
        await api(`${kbPath(detail.id)}/files/${action}`, {
          method: "POST",
          body: jsonBody({ paths }),
        });
      }
      toast.add({
        title: t(`files.done.${action}` as MessageKey, { count: paths.length }),
      });
      setSelected(new Set());
      await onChanged();
    } catch (reason) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(reason),
        type: "error",
      });
    }
  };

  const toggle = (path: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const crumbs = dir ? dir.split("/") : [];
  // Searches and status filters list matching files from every sub-folder.
  const flat = Boolean(q.trim()) || status !== "all";
  const counts = listing?.counts;
  const allSelected =
    files.length > 0 && files.every((file) => selected.has(file.path));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            placeholder={t("files.search")}
            aria-label={t("files.search")}
            className="pl-8"
            onChange={(event) => {
              setQuery(event.target.value);
              // Searching mid-composition would query half-typed pinyin/kana.
              if (!composing.current) setCommitted(event.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setQuery(event.currentTarget.value);
              setCommitted(event.currentTarget.value);
            }}
          />
        </div>
        <Segmented<FileStatus | "all">
          size="sm"
          value={status}
          onChange={setStatus}
          options={(["all", "ok", "failed", "skipped"] as const).map(
            (value) => ({
              value,
              label: t(`files.status.${value}` as MessageKey, {
                count: counts?.[value] ?? 0,
              }),
            }),
          )}
        />
      </div>

      <nav
        className="flex flex-wrap items-center gap-1 text-sm"
        aria-label={t("kb.tab.files")}
      >
        <button
          type="button"
          className={cn("hover:underline", !dir && "font-semibold")}
          onClick={() => setDir("")}
        >
          {t("kb.tree.root")}
        </button>
        {crumbs.map((part, at) => {
          const path = crumbs.slice(0, at + 1).join("/");
          return (
            <span key={path} className="flex items-center gap-1">
              <ChevronRightIcon className="text-muted-foreground size-3.5" />
              <button
                type="button"
                className={cn(
                  "hover:underline",
                  at === crumbs.length - 1 && "font-semibold",
                )}
                onClick={() => setDir(path)}
              >
                {part}
              </button>
            </span>
          );
        })}
        {flat ? (
          <span className="text-muted-foreground ml-2 text-xs">
            {t("files.searchAll")}
          </span>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            setScope([detail.id]);
            router.push(
              `/search${dir ? `?branch=${encodeURIComponent(dir)}` : ""}`,
            );
          }}
        >
          <SearchIcon />
          {t("kb.searchHere")}
        </Button>
      </nav>

      {selected.size ? (
        <div className="bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="font-medium">
            {t("files.selected", { count: selected.size })}
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void act("reprocess", [...selected])}
          >
            <RotateCcwIcon />
            {t("files.reprocess")}
          </Button>
          {managed ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void act("delete", [...selected])}
            >
              <Trash2Icon />
              {t("files.delete")}
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void act("exclude", [...selected])}
            >
              <BanIcon />
              {t("files.exclude")}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <XIcon />
            {t("common.cancel")}
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted/40 text-muted-foreground hidden grid-cols-[1.5rem_minmax(0,1fr)_6rem_4rem_5rem_7rem_6.5rem] items-center gap-2 border-b px-3 py-1.5 text-xs md:grid">
          <input
            type="checkbox"
            className="accent-primary size-3.5"
            aria-label={t("files.selectAll")}
            checked={allSelected}
            onChange={() =>
              setSelected(
                allSelected
                  ? new Set()
                  : new Set(files.map((file) => file.path)),
              )
            }
          />
          <span>{t("files.col.name")}</span>
          <span>{t("files.col.status")}</span>
          <span className="text-right">{t("files.col.chunks")}</span>
          <span className="text-right">{t("files.col.size")}</span>
          <span>{t("files.col.modified")}</span>
          <span />
        </div>
        <ul className="divide-y">
          {!flat
            ? listing?.folders.map((folder) => (
                <li key={folder.path}>
                  <button
                    type="button"
                    onClick={() => setDir(folder.path)}
                    className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <span className="hidden w-3.5 md:block" />
                    <FolderIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span
                      className="min-w-0 flex-1 truncate"
                      lang={guessLang(folder.name)}
                    >
                      {folder.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {t("files.folder", { files: folder.files })}
                      {folder.failed ? (
                        <span className="text-destructive">
                          {t("files.folderFailed", { failed: folder.failed })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))
            : null}
          {files.map((file) => (
            <li
              key={file.path}
              className={cn(
                "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-2 text-sm md:grid-cols-[1.5rem_minmax(0,1fr)_6rem_4rem_5rem_7rem_6.5rem]",
                selected.has(file.path) && "bg-primary/5",
              )}
            >
              <input
                type="checkbox"
                className="accent-primary size-3.5"
                aria-label={file.name}
                checked={selected.has(file.path)}
                onChange={() => toggle(file.path)}
              />
              <div className="flex min-w-0 items-center gap-2">
                <FileTypeIcon name={file.name} />
                <div className="flex min-w-0 flex-col">
                  <span
                    className="truncate"
                    lang={guessLang(file.name)}
                    title={file.path}
                  >
                    {file.name}
                  </span>
                  {flat && file.path !== file.name ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {file.path}
                    </span>
                  ) : null}
                  {file.message ? (
                    <span
                      className={cn(
                        "truncate text-xs",
                        file.status === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                      title={file.message}
                    >
                      {file.message}
                    </span>
                  ) : null}
                </div>
              </div>
              <Badge
                variant={STATUS_VARIANT[file.status]}
                className="hidden w-fit md:inline-flex"
              >
                {t(`files.badge.${file.status}` as MessageKey)}
              </Badge>
              <span className="text-muted-foreground hidden text-right text-xs tabular-nums md:block">
                {file.chunks || "—"}
              </span>
              <span className="text-muted-foreground hidden text-right text-xs tabular-nums md:block">
                {formatBytes(file.size)}
              </span>
              <span
                className="text-muted-foreground hidden text-xs md:block"
                title={new Date(file.mtime).toLocaleString()}
              >
                {formatRelative(file.mtime, lang)}
              </span>
              <div className="flex items-center justify-end gap-0.5">
                <Badge
                  variant={STATUS_VARIANT[file.status]}
                  className="mr-1 md:hidden"
                >
                  {t(`files.badge.${file.status}` as MessageKey)}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t("files.view")}
                  aria-label={`${t("files.view")} ${file.name}`}
                  disabled={file.status !== "ok"}
                  onClick={() =>
                    onOpenDoc({
                      kbId: detail.id,
                      docId: file.docId,
                      chunk: null,
                      title: file.name,
                    })
                  }
                >
                  <EyeIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t("files.raw")}
                  aria-label={`${t("files.raw")} ${file.name}`}
                  nativeButton={false}
                  render={
                    <a
                      href={`${kbPath(detail.id)}/files/raw?path=${encodeURIComponent(file.path)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLinkIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t("files.reprocess")}
                  aria-label={`${t("files.reprocess")} ${file.name}`}
                  onClick={() => void act("reprocess", [file.path])}
                >
                  <RotateCcwIcon />
                </Button>
                {managed ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t("files.delete")}
                    aria-label={`${t("files.delete")} ${file.name}`}
                    onClick={() => void act("delete", [file.path])}
                  >
                    <Trash2Icon />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t("files.exclude")}
                    aria-label={`${t("files.exclude")} ${file.name}`}
                    onClick={() => void act("exclude", [file.path])}
                  >
                    <BanIcon />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {loading && !listing ? (
          <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
            <Spinner /> {t("common.loading")}
          </div>
        ) : null}
        {listing && !files.length && !(listing.folders.length && !flat) ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            {detail.lastSync ? t("files.empty") : t("files.emptyNoSync")}
          </p>
        ) : null}
      </div>
      {listing && files.length < listing.total ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          disabled={loading}
          onClick={() => void load(files.length)}
        >
          {loading ? <Spinner /> : null}
          {t("files.more", { shown: files.length, total: listing.total })}
        </Button>
      ) : null}
    </div>
  );
}
