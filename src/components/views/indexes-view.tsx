"use client";

import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  DownloadIcon,
  EraserIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type { Settings, Task } from "meilisearch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { Page, RequireIndex, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody, waitForTask } from "@/lib/client";
import { LANGUAGE_PRESETS, SAMPLE_DATASETS } from "@/lib/samples";
import { cn } from "@/lib/utils";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function contentTypeFor(name: string, text: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) {
    return "application/x-ndjson";
  }
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

function IndexList() {
  const { t } = useI18n();
  const { indexes, indexUid, setIndexUid, refreshIndexes } = useWorkspace();
  const [uid, setUid] = useState("");
  const [primaryKey, setPrimaryKey] = useState("");
  const [language, setLanguage] = useState<string>("cmn");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    try {
      const preset = LANGUAGE_PRESETS.find((item) => item.id === language);
      const result = await api<{ uid: string; taskUid: number | null }>(
        "/api/indexes",
        {
          method: "POST",
          body: jsonBody({ uid, primaryKey, locales: preset?.locales ?? [] }),
        },
      );
      if (result.taskUid !== null) await waitForTask(result.taskUid);
      await refreshIndexes();
      setIndexUid(result.uid);
      setUid("");
      setPrimaryKey("");
      toast.add({ title: t("task.succeeded"), description: result.uid });
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  const remove = async (target: string) => {
    if (!window.confirm(t("data.deleteConfirm", { uid: target }))) return;
    setDeleting(target);
    try {
      const { taskUid } = await api<{ taskUid: number }>(
        `/api/indexes/${encodeURIComponent(target)}`,
        { method: "DELETE" },
      );
      await waitForTask(taskUid);
      await refreshIndexes();
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Section
      title={t("data.indexes")}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.refresh")}
          onClick={() => void refreshIndexes()}
        >
          <RefreshCwIcon />
        </Button>
      }
    >
      {indexes?.length ? (
        <ul className="divide-y rounded-lg border">
          {indexes.map((index) => (
            <li
              key={index.uid}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-sm font-medium">
                  {index.uid}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("data.docs", { count: index.numberOfDocuments })}
                  {index.primaryKey
                    ? ` · ${t("data.primaryKey")} ${index.primaryKey}`
                    : ""}
                </span>
              </div>
              {index.isIndexing ? (
                <Badge variant="warning">
                  <Spinner className="size-3" />
                  {t("data.indexing")}
                </Badge>
              ) : null}
              {index.uid === indexUid ? (
                <Badge variant="success">
                  <CheckIcon />
                  {t("data.current")}
                </Badge>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setIndexUid(index.uid)}
                >
                  {t("data.use")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${t("common.delete")} ${index.uid}`}
                disabled={deleting === index.uid}
                onClick={() => void remove(index.uid)}
              >
                {deleting === index.uid ? <Spinner /> : <Trash2Icon />}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label={t("data.uid")} htmlFor="new-index-uid">
          <Input
            id="new-index-uid"
            value={uid}
            required
            pattern="[A-Za-z0-9_\-]+"
            placeholder="articles_zh"
            onChange={(event) => setUid(event.target.value)}
          />
        </Field>
        <Field label={t("data.primaryKey")} htmlFor="new-index-pk">
          <Input
            id="new-index-pk"
            value={primaryKey}
            placeholder={t("data.primaryKey.hint")}
            onChange={(event) => setPrimaryKey(event.target.value)}
          />
        </Field>
        <Field label={t("data.language")}>
          <NativeSelect
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {LANGUAGE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {t(`data.lang.${preset.id}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={creating || !uid.trim()}>
          {creating ? <Spinner /> : <PlusIcon />}
          {t("data.create")}
        </Button>
      </form>
    </Section>
  );
}

function Samples() {
  const { t } = useI18n();
  const { refreshIndexes, setIndexUid, refreshDetail } = useWorkspace();
  const [loading, setLoading] = useState<string | null>(null);

  const load = async (id: string) => {
    setLoading(id);
    try {
      const result = await api<{ uid: string; documents: number }>(
        "/api/samples",
        {
          method: "POST",
          body: jsonBody({ dataset: id }),
        },
      );
      await refreshIndexes();
      setIndexUid(result.uid);
      await refreshDetail();
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

function Importer({ onImported }: { onImported: () => void }) {
  const { t } = useI18n();
  const { indexUid, refreshIndexes, refreshDetail } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [primaryKey, setPrimaryKey] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!indexUid) return;
    setBusy(true);
    try {
      let body: string;
      let contentType: string;
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES)
          throw new Error("File is larger than 100 MB");
        body = await file.text();
        contentType = contentTypeFor(file.name, body);
      } else {
        ({ body, contentType } = normalizePasted(pasted));
      }
      const params = new URLSearchParams();
      if (primaryKey.trim()) params.set("primaryKey", primaryKey.trim());
      const { taskUid } = await api<{ taskUid: number }>(
        `/api/indexes/${encodeURIComponent(indexUid)}/documents?${params}`,
        { method: "POST", body, headers: { "Content-Type": contentType } },
      );
      toast.add({ title: t("data.import.queued"), description: file?.name });
      onImported();
      await waitForTask(taskUid);
      toast.add({
        title: t("task.succeeded"),
        description: file?.name ?? indexUid,
      });
      setFile(null);
      setPasted("");
      await Promise.all([refreshIndexes(), refreshDetail()]);
    } catch (error) {
      toast.add({
        title: t("task.failed"),
        description: errorMessage(error),
        type: "error",
      });
    } finally {
      setBusy(false);
      onImported();
    }
  };

  return (
    <Section
      title={t("data.import")}
      description={t("data.import.desc", { index: indexUid ?? "" })}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) setFile(dropped);
        }}
        className={cn(
          "text-muted-foreground hover:bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors",
          dragging && "border-primary bg-muted/50",
        )}
      >
        <UploadIcon className="size-5" />
        {file ? (
          <span className="text-foreground font-medium">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </span>
        ) : (
          t("data.import.drop")
        )}
      </button>
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
        {file ? (
          <Button variant="ghost" onClick={() => setFile(null)}>
            {t("common.cancel")}
          </Button>
        ) : null}
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

function TaskLog({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const { indexUid } = useWorkspace();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const load = useCallback(async () => {
    if (!indexUid) return;
    try {
      const { tasks } = await api<{ tasks: Task[] }>(
        `/api/tasks?limit=12&indexUid=${encodeURIComponent(indexUid)}`,
      );
      setTasks(tasks);
    } catch {
      setTasks([]);
    }
  }, [indexUid]);

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

function SettingsJson() {
  const { t } = useI18n();
  const { indexUid, detail, refreshDetail, refreshIndexes } = useWorkspace();
  const original = useMemo(
    () => (detail ? JSON.stringify(detail.settings, null, 2) : ""),
    [detail],
  );
  const [text, setText] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the index changes
    setText(original);
    setError(null);
  }, [original]);

  const save = async () => {
    if (!indexUid || !detail) return;
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
        `/api/indexes/${encodeURIComponent(indexUid)}/settings`,
        { method: "PATCH", body: jsonBody(changed) },
      );
      await waitForTask(taskUid);
      toast.add({
        title: t("common.saved"),
        description: Object.keys(changed).join(", "),
      });
      await Promise.all([refreshDetail(), refreshIndexes()]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const clearDocuments = async () => {
    if (!indexUid || !window.confirm(t("data.clearConfirm", { uid: indexUid })))
      return;
    try {
      const { taskUid } = await api<{ taskUid: number }>(
        `/api/indexes/${encodeURIComponent(indexUid)}/documents`,
        { method: "DELETE" },
      );
      await waitForTask(taskUid);
      await Promise.all([refreshDetail(), refreshIndexes()]);
      toast.add({ title: t("task.succeeded"), description: t("data.clear") });
    } catch (reason) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(reason),
        type: "error",
      });
    }
  };

  return (
    <Collapsible className="group">
      <Section
        title={
          <CollapsibleTrigger className="hover:text-foreground flex items-center gap-1.5">
            {t("data.settingsJson")}
            <span className="text-muted-foreground font-mono text-xs">
              {indexUid}
            </span>
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
          <div className="flex flex-wrap gap-2">
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
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              onClick={() => void clearDocuments()}
            >
              <EraserIcon />
              {t("data.clear")}
            </Button>
          </div>
        </CollapsibleContent>
      </Section>
    </Collapsible>
  );
}

export function IndexesView() {
  const { t } = useI18n();
  const { status, indexUid } = useWorkspace();
  const [taskKey, setTaskKey] = useState(0);
  const offline = status !== null && !status.meilisearch.ok;

  return (
    <Page title={t("data.title")} description={t("data.desc")}>
      {offline ? (
        <RequireIndex>{null}</RequireIndex>
      ) : (
        <>
          <IndexList />
          <Samples />
          {indexUid ? (
            <>
              <Importer onImported={() => setTaskKey((key) => key + 1)} />
              <TaskLog refreshKey={taskKey} />
              <SettingsJson />
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}
