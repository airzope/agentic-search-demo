"use client";

import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  EraserIcon,
  FileTextIcon,
  FolderIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type { Settings, Task } from "meilisearch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { kbPath, useI18n, useWorkspace } from "@/components/app-providers";
import { DocViewer, type DocTarget } from "@/components/doc-viewer";
import { JobProgress } from "@/components/job-progress";
import { FileExplorer } from "@/components/kb-files";
import { IndexSettingsEditor, SyncHistory } from "@/components/kb-maintenance";
import { CheckField, splitList, startKbSync } from "@/components/kb-form";
import { EmptyState, Page, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { KbTypeBadge } from "@/components/views/kb-list-view";
import { guessLang } from "@/lib/cjk";
import {
  api,
  errorMessage,
  jsonBody,
  uploadForm,
  waitForTask,
} from "@/lib/client";
import { fieldText } from "@/lib/display";
import { formatBytes, formatRelative } from "@/lib/format";
import type { FileStatus } from "@/lib/kb/files";
import type { KbDetail, KbDocument, TreeNode } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const notify = (title: string, description?: string) =>
  toast.add({ title, description, type: "error" });

/* --------------------------------------------------------------- loading */

function useKbDetail(id: string) {
  const [detail, setDetail] = useState<KbDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await api<KbDetail>(kbPath(id)));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [id]);

  useEffect(() => {
    // Async loader: state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  // Poll while a sync job runs or Meilisearch is still indexing.
  const busy =
    detail?.job?.status === "running" ||
    detail?.job?.status === "queued" ||
    detail?.stats.isIndexing;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void reload(), 1500);
    return () => clearInterval(timer);
  }, [busy, reload]);

  return { detail, error, reload };
}

/* -------------------------------------------------------------- overview */

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function Overview({
  detail,
  reload,
  onShowFailed,
}: {
  detail: KbDetail;
  reload: () => Promise<void>;
  onShowFailed: () => void;
}) {
  const { t, lang } = useI18n();
  const config = detail.config;
  const job = detail.job;

  const cancel = async () => {
    if (!job) return;
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      await reload();
    } catch (reason) {
      notify(t("common.error"), errorMessage(reason));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title={t("kb.tab.overview")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {detail.schema.chunked ? (
            <>
              <Stat label={t("kb.stat.files")}>
                {detail.lastSync?.files ?? "—"}
              </Stat>
              <Stat label={t("kb.stat.chunks")}>
                {detail.stats.numberOfDocuments}
              </Stat>
            </>
          ) : (
            <Stat label={t("kb.stat.records")}>
              {detail.stats.numberOfDocuments}
            </Stat>
          )}
          <Stat label={t("kb.stat.vector")}>
            {detail.schema.vector
              ? t("kb.vector", { dims: detail.schema.vector.dimensions })
              : detail.schema.embedders.length
                ? detail.schema.embedders.join(", ")
                : t("kb.vector.none")}
          </Stat>
          {config ? (
            <Stat label={t("kb.stat.chunking")}>
              {t("kb.chunking", {
                size: config.chunk.size,
                overlap: config.chunk.overlap,
              })}
            </Stat>
          ) : null}
          <Stat label={t("kb.connection")}>{detail.connectionName}</Stat>
          {config ? (
            <Stat label={t("kb.stat.lastSync")}>
              {detail.lastSync ? (
                <span
                  title={new Date(detail.lastSync.finishedAt).toLocaleString()}
                >
                  {formatRelative(detail.lastSync.finishedAt, lang)}
                </span>
              ) : (
                t("kb.neverSynced")
              )}
            </Stat>
          ) : null}
          {config?.embedding.model ? (
            <Stat label={t("kb.stat.model")}>{config.embedding.model}</Stat>
          ) : null}
        </dl>
        {detail.root ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">
              {t("kb.root")}
            </span>
            <code className="bg-muted rounded-md px-2 py-1 text-xs break-all">
              {detail.root}
            </code>
          </div>
        ) : null}
        {config?.description ? (
          <p className="text-muted-foreground text-sm">{config.description}</p>
        ) : null}
      </Section>

      {job ? (
        <Section title={t("kb.job.title")}>
          <JobProgress job={job} onCancel={() => void cancel()} />
        </Section>
      ) : null}

      {detail.lastSync?.failed ? (
        <button
          type="button"
          onClick={onShowFailed}
          className="border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm"
        >
          <CircleAlertIcon className="size-4 shrink-0" />
          {t("kb.failedLink", { count: detail.lastSync.failed })}
        </button>
      ) : null}

      {config ? <SyncHistory detail={detail} /> : null}
    </div>
  );
}

function ConfigEditor({
  detail,
  onSaved,
}: {
  detail: KbDetail;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const config = detail.config!;
  const source = config.source;
  const initial = useMemo(
    () => ({
      name: config.name,
      description: config.description,
      include: source.type === "directory" ? source.include.join(", ") : "",
      exclude: source.type === "directory" ? source.exclude.join(", ") : "",
      ocrImages: source.ocrImages,
      ocrEmbedded: source.ocrEmbedded,
      watch: source.type === "directory" ? source.watch : false,
      maxFileSizeMb: String(source.maxFileSizeMb),
    }),
    [config, source],
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the saved config changes
    setForm(initial);
  }, [initial]);

  const save = async () => {
    setSaving(true);
    try {
      await api(kbPath(detail.id), {
        method: "PATCH",
        body: jsonBody({
          name: form.name,
          description: form.description,
          source: {
            ocrImages: form.ocrImages,
            ocrEmbedded: form.ocrEmbedded,
            maxFileSizeMb: Number(form.maxFileSizeMb) || undefined,
            ...(source.type === "directory"
              ? {
                  include: splitList(form.include),
                  exclude: splitList(form.exclude),
                  watch: form.watch,
                }
              : {}),
          },
        }),
      });
      toast.add({ title: t("common.saved") });
      await onSaved();
    } catch (reason) {
      notify(t("common.error"), errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t("kb.config")} description={t("kb.config.hint")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("kb.name")}>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label={t("kb.maxFileSize")}>
          <Input
            type="number"
            min={1}
            max={2048}
            value={form.maxFileSizeMb}
            onChange={(event) =>
              setForm({ ...form, maxFileSizeMb: event.target.value })
            }
          />
        </Field>
      </div>
      <Field label={t("kb.description")} hint={t("kb.description.hint")}>
        <Textarea
          rows={2}
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.target.value })
          }
        />
      </Field>
      {source.type === "directory" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("kb.include")} hint={t("kb.include.hint")}>
            <Input
              value={form.include}
              placeholder="pdf, docx, md"
              onChange={(event) =>
                setForm({ ...form, include: event.target.value })
              }
            />
          </Field>
          <Field label={t("kb.exclude")} hint={t("kb.exclude.hint")}>
            <Input
              value={form.exclude}
              placeholder="drafts/**, *.bak"
              onChange={(event) =>
                setForm({ ...form, exclude: event.target.value })
              }
            />
          </Field>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <CheckField
          checked={form.ocrImages}
          onChange={(ocrImages) => setForm({ ...form, ocrImages })}
        >
          {t("kb.ocrImages")}
        </CheckField>
        <CheckField
          checked={form.ocrEmbedded}
          disabled={!form.ocrImages}
          onChange={(ocrEmbedded) => setForm({ ...form, ocrEmbedded })}
        >
          {t("kb.ocrEmbedded")}
        </CheckField>
        {source.type === "directory" ? (
          <CheckField
            checked={form.watch}
            onChange={(watch) => setForm({ ...form, watch })}
          >
            {t("kb.watch")}
          </CheckField>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? <Spinner /> : null}
          {t("common.save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={() => setForm(initial)}
        >
          {t("common.revert")}
        </Button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ tree */

type TreeLevel = {
  branch: string | null;
  totalDocs: number;
  children: TreeNode[];
  documents: KbDocument[];
  moreDocuments: boolean;
};

function TreeBrowser({ detail }: { detail: KbDetail }) {
  const { t } = useI18n();
  const { setScope } = useWorkspace();
  const router = useRouter();
  const [branch, setBranch] = useState<string | null>(null);
  const [level, setLevel] = useState<TreeLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<DocTarget | null>(null);
  const documentCount = detail.stats.numberOfDocuments;

  useEffect(() => {
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    api<TreeLevel>(`${kbPath(detail.id)}/tree${query}`)
      .then((next) => {
        setLevel(next);
        setError(null);
      })
      .catch((reason) => setError(errorMessage(reason)));
    // Reload when the document count changes (sync finished).
  }, [detail.id, branch, documentCount]);

  const crumbs = branch ? branch.split("/") : [];
  const searchHere = () => {
    setScope([detail.id]);
    router.push(
      `/search${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    );
  };

  return (
    <Section
      title={
        <nav
          className="flex flex-wrap items-center gap-1 text-sm"
          aria-label={t("kb.tab.tree")}
        >
          <button
            type="button"
            className={cn("hover:underline", !branch && "font-semibold")}
            onClick={() => setBranch(null)}
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
                  onClick={() => setBranch(path)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </nav>
      }
      actions={
        <Button size="sm" variant="outline" onClick={searchHere}>
          <SearchIcon />
          {t("kb.searchHere")}
        </Button>
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {!level && !error ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      ) : null}
      {level ? (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">
            {t("kb.files", { count: level.totalDocs })}
          </p>
          <ul className="flex flex-col">
            {level.children.map((node) => (
              <li key={node.branch}>
                <button
                  type="button"
                  onClick={() => setBranch(node.branch)}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                >
                  <FolderIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    lang={guessLang(node.name)}
                  >
                    {node.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {node.docs}
                  </span>
                </button>
              </li>
            ))}
            {level.documents.map((doc) => (
              <li key={doc.doc_id}>
                <button
                  type="button"
                  onClick={() =>
                    setTarget({
                      kbId: detail.id,
                      docId: doc.doc_id,
                      chunk: null,
                      title: doc.title,
                    })
                  }
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                >
                  <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    lang={guessLang(doc.title)}
                  >
                    {doc.title || doc.path.split("/").pop()}
                  </span>
                  <span className="text-muted-foreground hidden shrink-0 font-mono text-xs sm:inline">
                    {doc.path.split("/").pop()}
                  </span>
                  {doc.chunk_count ? (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {t("kb.doc.of", { count: doc.chunk_count })}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {!level.children.length && !level.documents.length ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {t("kb.tree.empty")}
            </p>
          ) : null}
          {level.moreDocuments ? (
            <p className="text-muted-foreground text-xs">{t("kb.tree.more")}</p>
          ) : null}
        </div>
      ) : null}
      <DocViewer target={target} onClose={() => setTarget(null)} />
    </Section>
  );
}

/** First records of a plain (non-chunked) index. */
function RecordList({ detail }: { detail: KbDetail }) {
  const { t } = useI18n();
  const [records, setRecords] = useState<Record<string, unknown>[] | null>(
    null,
  );
  const [target, setTarget] = useState<DocTarget | null>(null);
  const documentCount = detail.stats.numberOfDocuments;

  useEffect(() => {
    api<{ results: Record<string, unknown>[] }>(
      `${kbPath(detail.id)}/documents?limit=50`,
    )
      .then((result) => setRecords(result.results))
      .catch(() => setRecords([]));
  }, [detail.id, documentCount]);

  const key = detail.primaryKey ?? "id";
  const titleField = detail.display.title;

  return (
    <Section title={t("kb.stat.records")} description={t("kb.tree.notChunked")}>
      {records === null ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      ) : (
        <ul className="flex flex-col">
          {records.map((record) => {
            const id = fieldText(record[key]);
            const title = titleField ? fieldText(record[titleField]) : id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() =>
                    setTarget({
                      kbId: detail.id,
                      docId: id,
                      chunk: null,
                      title,
                    })
                  }
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                >
                  <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    lang={guessLang(title)}
                  >
                    {title || id}
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <DocViewer target={target} onClose={() => setTarget(null)} />
    </Section>
  );
}

/* ---------------------------------------------------------------- upload */

function Uploader({
  detail,
  reload,
}: {
  detail: KbDetail;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // `webkitdirectory` is not in React's input props.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  if (detail.config?.source.type === "directory") {
    return (
      <Section title={t("kb.tab.upload")}>
        <p className="text-muted-foreground text-sm">
          {t("kb.upload.mapped", { path: detail.root ?? "" })}
        </p>
      </Section>
    );
  }

  const upload = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) {
        form.append("file", file);
        form.append("path", file.webkitRelativePath || file.name);
      }
      form.append("folder", folder);
      setProgress(0);
      const result = await uploadForm<{ saved: string[] }>(
        `${kbPath(detail.id)}/files`,
        form,
        (loaded, size) => setProgress(loaded / size),
      );
      toast.add({ title: t("kb.upload.done", { count: result.saved.length }) });
      setFiles([]);
      await reload();
    } catch (reason) {
      notify(t("common.error"), errorMessage(reason));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const total = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <Section title={t("kb.tab.upload")} description={t("kb.upload.desc")}>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          setFiles([...files, ...Array.from(event.dataTransfer.files)]);
        }}
        className={cn(
          "text-muted-foreground hover:bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm transition-colors",
          dragging && "border-primary bg-muted/50",
        )}
      >
        <UploadIcon className="size-5" />
        {files.length ? (
          <span className="text-foreground font-medium">
            {t("kb.upload.selected", {
              count: files.length,
              size: formatBytes(total),
            })}
          </span>
        ) : (
          t("kb.upload.drop")
        )}
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          setFiles([...files, ...Array.from(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          setFiles([...files, ...Array.from(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {files.length ? (
        <ul className="text-muted-foreground flex max-h-40 flex-col gap-0.5 overflow-y-auto font-mono text-xs">
          {files.slice(0, 200).map((file, at) => (
            <li key={`${file.name}-${at}`} className="truncate">
              {file.webkitRelativePath || file.name} · {formatBytes(file.size)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("kb.upload.folder")} className="min-w-56 flex-1">
          <Input
            value={folder}
            placeholder="合同/2026"
            onChange={(event) => setFolder(event.target.value)}
          />
        </Field>
        <Button variant="outline" onClick={() => folderInput.current?.click()}>
          <FolderIcon />
          {t("kb.upload.selectFolder")}
        </Button>
        <Button disabled={!files.length || busy} onClick={() => void upload()}>
          {busy ? <Spinner /> : <UploadIcon />}
          {progress !== null
            ? `${Math.round(progress * 100)}%`
            : t("kb.upload.submit")}
        </Button>
        {files.length ? (
          <Button variant="ghost" onClick={() => setFiles([])}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- advanced */

function contentTypeFor(name: string, text: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl"))
    return "application/x-ndjson";
  // A JSON file that is not an array is treated as NDJSON (one object per line).
  return text.trimStart().startsWith("[")
    ? "application/json"
    : "application/x-ndjson";
}

/** Accept a JSON array, a single object, or NDJSON; validate before upload. */
function normalizePasted(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    JSON.parse(trimmed);
    return { body: trimmed, contentType: "application/json" };
  }
  try {
    return {
      body: JSON.stringify([JSON.parse(trimmed)]),
      contentType: "application/json",
    };
  } catch {
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    lines.forEach((line) => JSON.parse(line));
    return { body: lines.join("\n"), contentType: "application/x-ndjson" };
  }
}

/** Raw JSON / NDJSON / CSV records, for plain indexes. */
function RecordImporter({
  detail,
  onChanged,
}: {
  detail: KbDetail;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [primaryKey, setPrimaryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setBusy(true);
    try {
      let body: string;
      let contentType: string;
      if (file) {
        if (file.size > MAX_IMPORT_BYTES)
          throw new Error("File is larger than 100 MB");
        body = await file.text();
        contentType = contentTypeFor(file.name, body);
      } else {
        ({ body, contentType } = normalizePasted(pasted));
      }
      const params = new URLSearchParams();
      if (primaryKey.trim()) params.set("primaryKey", primaryKey.trim());
      const { taskUid } = await api<{ taskUid: number }>(
        `${kbPath(detail.id)}/documents?${params}`,
        { method: "POST", body, headers: { "Content-Type": contentType } },
      );
      toast.add({ title: t("data.import.queued"), description: file?.name });
      onChanged();
      await waitForTask(taskUid, detail.id);
      toast.add({
        title: t("task.succeeded"),
        description: file?.name ?? detail.name,
      });
      setFile(null);
      setPasted("");
    } catch (reason) {
      notify(t("task.failed"), errorMessage(reason));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Section
      title={t("data.import")}
      description={t("data.import.desc", { index: detail.name })}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon />
          {file
            ? `${file.name} · ${formatBytes(file.size)}`
            : t("data.import.drop")}
        </Button>
        {file ? (
          <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.ndjson,.jsonl,.csv,application/json,text/csv"
        className="hidden"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      {!file ? (
        <Field label={t("data.import.paste")}>
          <Textarea
            rows={4}
            spellCheck={false}
            value={pasted}
            placeholder='[{ "id": 1, "title": "标题", "content": "正文…" }]'
            onChange={(event) => setPasted(event.target.value)}
            className="field-sizing-fixed font-mono text-xs md:text-xs"
          />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("data.primaryKey")} className="w-48">
          <Input
            value={primaryKey}
            placeholder={t("common.optional")}
            onChange={(event) => setPrimaryKey(event.target.value)}
          />
        </Field>
        <Button
          disabled={busy || (!file && !pasted.trim())}
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : <UploadIcon />}
          {t("data.import.submit")}
        </Button>
      </div>
    </Section>
  );
}

const TASK_ICON = {
  succeeded: (
    <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
  ),
  failed: <CircleAlertIcon className="text-destructive size-4" />,
  canceled: <CircleAlertIcon className="text-muted-foreground size-4" />,
  enqueued: <ClockIcon className="text-muted-foreground size-4" />,
  processing: <Spinner className="size-4" />,
} as const;

function TaskLog({ kbId, refreshKey }: { kbId: string; refreshKey: number }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { tasks } = await api<{ tasks: Task[] }>(
        `/api/tasks?limit=12&kb=${encodeURIComponent(kbId)}`,
      );
      setTasks(tasks);
    } catch {
      setTasks([]);
    }
  }, [kbId]);

  useEffect(() => {
    // Async loader: state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  const pending = tasks?.some(
    (task) => task.status === "enqueued" || task.status === "processing",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [pending, load]);

  return (
    <Section
      title={t("data.tasks")}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.refresh")}
          onClick={() => void load()}
        >
          <RefreshCwIcon />
        </Button>
      }
    >
      {tasks?.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {tasks.map((task) => (
            <li key={task.uid} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{TASK_ICON[task.status]}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-xs">#{task.uid}</span>
                  <span>{task.type}</span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(task.enqueuedAt).toLocaleString()}
                  </span>
                </span>
                {task.error ? (
                  <span className="text-destructive text-xs wrap-break-word">
                    {task.error.message}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {tasks ? t("data.tasks.empty") : t("common.loading")}
        </p>
      )}
    </Section>
  );
}

function SettingsJson({
  detail,
  onSaved,
}: {
  detail: KbDetail;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const original = useMemo(
    () => JSON.stringify(detail.settings, null, 2),
    [detail.settings],
  );
  const [text, setText] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the settings change
    setText(original);
    setError(null);
  }, [original]);

  const save = async () => {
    let next: Settings;
    try {
      next = JSON.parse(text) as Settings;
    } catch (reason) {
      setError(t("data.invalidJson", { message: errorMessage(reason) }));
      return;
    }
    const current = detail.settings as Record<string, unknown>;
    const changed = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(current[key]),
      ),
    );
    if (!Object.keys(changed).length) return;
    setSaving(true);
    setError(null);
    try {
      const { taskUid } = await api<{ taskUid: number }>(
        `${kbPath(detail.id)}/settings`,
        {
          method: "PATCH",
          body: jsonBody(changed),
        },
      );
      await waitForTask(taskUid, detail.id);
      toast.add({
        title: t("common.saved"),
        description: Object.keys(changed).join(", "),
      });
      await onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Collapsible>
      <Section
        title={
          <CollapsibleTrigger className="hover:text-foreground flex items-center gap-1.5">
            {t("data.settingsJson")}
          </CollapsibleTrigger>
        }
        description={t("data.settingsJson.hint")}
      >
        <CollapsibleContent className="flex flex-col gap-3">
          <Textarea
            rows={18}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="field-sizing-fixed font-mono text-xs leading-relaxed md:text-xs"
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={saving || text === original}
              onClick={() => void save()}
            >
              {saving ? <Spinner /> : null}
              {t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={text === original}
              onClick={() => setText(original)}
            >
              {t("common.revert")}
            </Button>
          </div>
        </CollapsibleContent>
      </Section>
    </Collapsible>
  );
}

function DangerZone({
  detail,
  reload,
}: {
  detail: KbDetail;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { refreshKbs } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const rebuild = async () => {
    if (!window.confirm(t("kb.rebuildConfirm", { name: detail.name }))) return;
    setBusy("rebuild");
    const job = await startKbSync(detail.id, { rebuild: true }, (message) =>
      notify(t("common.error"), message),
    );
    setBusy(null);
    if (job) await reload();
  };

  const clear = async () => {
    if (!window.confirm(t("data.clearConfirm", { uid: detail.name }))) return;
    setBusy("clear");
    try {
      const { taskUid } = await api<{ taskUid: number }>(
        `${kbPath(detail.id)}/documents`,
        {
          method: "DELETE",
        },
      );
      await waitForTask(taskUid, detail.id);
      await Promise.all([reload(), refreshKbs()]);
    } catch (reason) {
      notify(t("common.error"), errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("kb.deleteConfirm", { name: detail.name }))) return;
    setBusy("delete");
    try {
      await api(kbPath(detail.id), { method: "DELETE" });
      await refreshKbs();
      router.push("/kb");
    } catch (reason) {
      notify(t("common.error"), errorMessage(reason));
      setBusy(null);
    }
  };

  return (
    <Section title={t("kb.danger")}>
      <div className="flex flex-col gap-3">
        {detail.config ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground max-w-xl text-sm">
              {t("kb.rebuild.hint")}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void rebuild()}
            >
              {busy === "rebuild" ? <Spinner /> : <RotateCcwIcon />}
              {t("kb.rebuild")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground max-w-xl text-sm">
              {t("kb.clear.hint")}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void clear()}
            >
              {busy === "clear" ? <Spinner /> : <EraserIcon />}
              {t("data.clear")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground max-w-xl text-sm">
            {t("kb.delete.hint")}
          </p>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? <Spinner /> : <Trash2Icon />}
            {t("common.delete")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ page */

export function KbDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const { setKbId, refreshKbs } = useWorkspace();
  const router = useRouter();
  const { detail, error, reload } = useKbDetail(id);
  const [taskKey, setTaskKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const [tab, setTab] = useState("overview");
  const [fileStatus, setFileStatus] = useState<FileStatus | null>(null);
  const [opened, setOpened] = useState<DocTarget | null>(null);

  const running =
    detail?.job?.status === "running" || detail?.job?.status === "queued";

  // Refresh the sidebar counts once a sync finishes.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      void refreshKbs();
    }
  }, [running, refreshKbs]);

  const sync = async (force: boolean) => {
    setStarting(true);
    const job = await startKbSync(id, { force }, (message) =>
      notify(t("common.error"), message),
    );
    setStarting(false);
    if (job) await Promise.all([reload(), refreshKbs()]);
  };

  const openIn = (path: string) => {
    setKbId(id);
    router.push(path);
  };

  if (!detail) {
    return (
      <Page title={t("kb.title")}>
        {error ? (
          <EmptyState
            icon={CircleAlertIcon}
            title={t("kb.notFound")}
            description={error}
            action={
              <Button nativeButton={false} render={<Link href="/kb" />}>
                <ArrowLeftIcon />
                {t("kb.back")}
              </Button>
            }
          />
        ) : (
          <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
            <Spinner /> {t("common.loading")}
          </div>
        )}
      </Page>
    );
  }

  return (
    <Page
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href="/kb"
            aria-label={t("kb.back")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-5" />
          </Link>
          <span lang={guessLang(detail.name)}>{detail.name}</span>
          <KbTypeBadge
            kb={{ config: detail.config, chunked: detail.schema.chunked }}
          />
        </span>
      }
      description={
        <span className="font-mono text-xs">
          {detail.connectionName} · {detail.uid}
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openIn("/tokenization")}
          >
            {t("nav.tokenization")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openIn("/embedders")}
          >
            {t("nav.embedders")}
          </Button>
          {detail.config ? (
            <>
              {detail.failedFiles.length ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={starting || running}
                  onClick={() => void sync(true)}
                >
                  <RotateCcwIcon />
                  {t("kb.syncForce")}
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={starting || running}
                onClick={() => void sync(false)}
              >
                {starting || running ? <Spinner /> : <RefreshCwIcon />}
                {running && detail.job
                  ? t("kb.syncing", {
                      done: detail.job.processed,
                      total: detail.job.total,
                    })
                  : t("kb.sync")}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="overview">{t("kb.tab.overview")}</TabsTrigger>
          <TabsTrigger value="tree">
            {detail.config
              ? t("kb.tab.files")
              : detail.schema.chunked
                ? t("kb.tab.tree")
                : t("kb.stat.records")}
          </TabsTrigger>
          {detail.config?.source.type === "managed" ? (
            <TabsTrigger value="upload">{t("kb.tab.upload")}</TabsTrigger>
          ) : null}
          {detail.config ? (
            <TabsTrigger value="settings">{t("kb.tab.settings")}</TabsTrigger>
          ) : null}
          <TabsTrigger value="advanced">{t("kb.tab.advanced")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview
            detail={detail}
            reload={reload}
            onShowFailed={() => {
              setFileStatus("failed");
              setTab("tree");
            }}
          />
        </TabsContent>
        <TabsContent value="tree" className="flex flex-col gap-4">
          {detail.config ? (
            <>
              <FileExplorer
                key={fileStatus ?? "all"}
                detail={detail}
                initialStatus={fileStatus}
                onOpenDoc={setOpened}
                onChanged={reload}
              />
            </>
          ) : detail.schema.chunked ? (
            <TreeBrowser detail={detail} />
          ) : (
            <RecordList detail={detail} />
          )}
        </TabsContent>
        {detail.config?.source.type === "managed" ? (
          <TabsContent value="upload">
            <Uploader detail={detail} reload={reload} />
          </TabsContent>
        ) : null}
        {detail.config ? (
          <TabsContent value="settings" className="flex flex-col gap-4">
            <ConfigEditor
              detail={detail}
              onSaved={async () => {
                await Promise.all([reload(), refreshKbs()]);
              }}
            />
            <IndexSettingsEditor
              detail={detail}
              onSaved={async () => {
                await Promise.all([reload(), refreshKbs()]);
              }}
            />
          </TabsContent>
        ) : null}
        <TabsContent value="advanced" className="flex flex-col gap-4">
          {!detail.schema.chunked ? (
            <RecordImporter
              detail={detail}
              onChanged={() => setTaskKey((key) => key + 1)}
            />
          ) : null}
          <TaskLog kbId={detail.id} refreshKey={taskKey} />
          <SettingsJson
            detail={detail}
            onSaved={async () => {
              await Promise.all([reload(), refreshKbs()]);
            }}
          />
          <DangerZone detail={detail} reload={reload} />
        </TabsContent>
      </Tabs>
      <DocViewer target={opened} onClose={() => setOpened(null)} />
    </Page>
  );
}
