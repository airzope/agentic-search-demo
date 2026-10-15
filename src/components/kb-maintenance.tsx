"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { kbPath, useI18n } from "@/components/app-providers";
import { CheckField } from "@/components/kb-form";
import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody } from "@/lib/client";
import { formatDuration, formatRelative } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type { SyncRecord } from "@/lib/kb/jobs";
import type { KbDetail } from "@/lib/kb/types";
import { BUILTIN_EMBEDDING } from "@/lib/providers";
import { LANGUAGE_PRESETS } from "@/lib/samples";

/** The last syncs of a knowledge base, newest first. */
export function SyncHistory({ detail }: { detail: KbDetail }) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<SyncRecord[] | null>(null);
  const finished = detail.job?.finishedAt ?? detail.lastSync?.finishedAt ?? "";

  useEffect(() => {
    api<{ history: SyncRecord[] }>(`${kbPath(detail.id)}/history`)
      .then((result) => setHistory(result.history))
      .catch(() => setHistory([]));
  }, [detail.id, finished]);

  return (
    <Section title={t("history.title")}>
      {!history ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      ) : history.length ? (
        <ol className="flex flex-col gap-2 text-sm">
          {history.slice(0, 10).map((record) => {
            const Icon =
              record.status === "done"
                ? CircleCheckIcon
                : record.status === "canceled"
                  ? CircleSlashIcon
                  : CircleAlertIcon;
            const duration =
              record.startedAt && record.finishedAt
                ? new Date(record.finishedAt).getTime() -
                  new Date(record.startedAt).getTime()
                : null;
            return (
              <li key={record.id} className="flex items-start gap-2">
                <Icon
                  className={
                    record.status === "done"
                      ? "mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      : record.status === "canceled"
                        ? "text-muted-foreground mt-0.5 size-4 shrink-0"
                        : "text-destructive mt-0.5 size-4 shrink-0"
                  }
                />
                <div className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span
                      title={
                        record.finishedAt
                          ? new Date(record.finishedAt).toLocaleString()
                          : ""
                      }
                    >
                      {record.finishedAt
                        ? formatRelative(record.finishedAt, lang)
                        : "—"}
                    </span>
                    {record.rebuild ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <RotateCcwIcon className="size-3" />
                        {t("history.rebuild")}
                      </span>
                    ) : null}
                    {duration !== null ? (
                      <span className="text-muted-foreground text-xs">
                        {formatDuration(duration, lang)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("kb.job.stats", {
                      added: record.added,
                      updated: record.updated,
                      deleted: record.deleted,
                      skipped: record.skipped,
                      failed: record.failed,
                      chunks: record.chunks,
                    })}
                  </span>
                  {record.message ? (
                    <span className="text-destructive text-xs wrap-break-word">
                      {record.message}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">{t("history.empty")}</p>
      )}
    </Section>
  );
}

/** Language, chunking, vectors and scale; most changes rebuild the index. */
export function IndexSettingsEditor({
  detail,
  onSaved,
}: {
  detail: KbDetail;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const config = detail.config!;
  const initial = useMemo(
    () => ({
      language: (LANGUAGE_PRESETS.find(
        (preset) => preset.locales.join() === config.locales.join(),
      )?.id ?? "none") as string,
      chunkSize: String(config.chunk.size),
      chunkOverlap: String(config.chunk.overlap),
      embedding: config.embedding.enabled,
      dimensions: config.embedding.dimensions,
      scale: config.scale,
    }),
    [config],
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the saved config changes
    setForm(initial);
  }, [initial]);

  const rebuildNeeded =
    form.chunkSize !== initial.chunkSize ||
    form.chunkOverlap !== initial.chunkOverlap ||
    form.embedding !== initial.embedding ||
    (form.embedding && form.dimensions !== initial.dimensions) ||
    form.scale !== initial.scale;
  const dirty = rebuildNeeded || form.language !== initial.language;

  const save = async () => {
    if (
      rebuildNeeded &&
      !window.confirm(t("index.rebuildConfirm", { name: config.name }))
    ) {
      return;
    }
    setSaving(true);
    try {
      const preset = LANGUAGE_PRESETS.find((item) => item.id === form.language);
      const result = await api<{ rebuild: boolean }>(kbPath(detail.id), {
        method: "PATCH",
        body: jsonBody({
          locales: preset?.locales ?? [],
          chunk: {
            size: Number(form.chunkSize),
            overlap: Number(form.chunkOverlap),
          },
          embedding: { enabled: form.embedding, dimensions: form.dimensions },
          scale: form.scale,
        }),
      });
      toast.add({
        title: result.rebuild ? t("index.rebuildStarted") : t("common.saved"),
      });
      await onSaved();
    } catch (reason) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(reason),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t("index.title")} description={t("index.desc")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("kb.language")}>
          <NativeSelect
            value={form.language}
            onChange={(event) =>
              setForm({ ...form, language: event.target.value })
            }
          >
            {LANGUAGE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {t(`data.lang.${preset.id}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("kb.scale")} group>
          <Segmented
            value={form.scale}
            onChange={(scale) => setForm({ ...form, scale })}
            options={[
              { value: "standard", label: t("kb.scale.standard") },
              { value: "large", label: t("kb.scale.large") },
            ]}
          />
        </Field>
        <Field label={t("kb.chunkSize")}>
          <Input
            type="number"
            min={200}
            max={4000}
            value={form.chunkSize}
            onChange={(event) =>
              setForm({ ...form, chunkSize: event.target.value })
            }
          />
        </Field>
        <Field label={t("kb.chunkOverlap")}>
          <Input
            type="number"
            min={0}
            max={1000}
            value={form.chunkOverlap}
            onChange={(event) =>
              setForm({ ...form, chunkOverlap: event.target.value })
            }
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <CheckField
          checked={form.embedding}
          onChange={(embedding) => setForm({ ...form, embedding })}
        >
          {t("kb.embedding")}
        </CheckField>
        <Field label={t("kb.dimensions")} className="w-40">
          <NativeSelect
            value={String(form.dimensions)}
            disabled={!form.embedding}
            onChange={(event) =>
              setForm({ ...form, dimensions: Number(event.target.value) })
            }
          >
            {BUILTIN_EMBEDDING.dimensionOptions.map((dims) => (
              <option key={dims} value={dims}>
                {dims}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {rebuildNeeded ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("index.rebuildNote")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? <Spinner /> : null}
          {rebuildNeeded ? t("index.saveRebuild") : t("common.save")}
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
