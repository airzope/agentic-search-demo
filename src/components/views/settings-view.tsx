"use client";

import {
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ListIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { useTheme } from "@/components/app-shell";
import { CheckField } from "@/components/kb-form";
import { Page, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody } from "@/lib/client";
import {
  BUILTIN_EMBEDDING,
  DEFAULT_QUERY_INSTRUCTION,
  REMOTE_EMBEDDING_PRESETS,
  type EmbeddingEngine,
  type ModelSource,
  type PublicProvider,
  type PublicSettings,
  type SettingsPatch,
} from "@/lib/providers";

import type { MessageKey } from "@/lib/i18n";
import {
  OCR_MODELS,
  OCR_SOURCES,
  type OcrModelId,
  type OcrSource,
} from "@/lib/ocr/catalog";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

async function saveSettings(patch: SettingsPatch) {
  return api<PublicSettings>("/api/settings", {
    method: "PUT",
    body: jsonBody(patch),
  });
}

function MeilisearchSettings({
  settings,
  onSaved,
}: {
  settings: PublicSettings["meilisearch"];
  onSaved: (settings: PublicSettings) => void;
}) {
  const { t } = useI18n();
  const { status, refreshStatus, refreshKbs } = useWorkspace();
  const [host, setHost] = useState(settings.host);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await saveSettings({
          meilisearch: { host, apiKey: apiKey ? apiKey : undefined },
        }),
      );
      setApiKey("");
      await Promise.all([refreshStatus(), refreshKbs()]);
      toast.add({ title: t("settings.saved") });
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={t("settings.meili")}
      description={t("settings.meili.desc")}
      actions={
        status ? (
          status.meilisearch.ok ? (
            <Badge variant="success">
              <CheckIcon />v{status.meilisearch.version}
            </Badge>
          ) : (
            <Badge variant="destructive" title={status.meilisearch.error}>
              <CircleAlertIcon />
              {t("status.offline")}
            </Badge>
          )
        ) : null
      }
    >
      <form
        className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label={t("settings.host")}
          hint={
            settings.hostSource === "env" ? t("settings.fromEnv") : undefined
          }
        >
          <Input
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </Field>
        <Field
          label={t("settings.apiKey")}
          hint={
            settings.keySource
              ? `${settings.keyHint ?? ""} ${settings.keySource === "env" ? `· ${t("settings.fromEnv")}` : ""}`
              : undefined
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={
              settings.hasKey ? t("settings.keepKey") : "MEILI_MASTER_KEY"
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={saving} className="sm:mb-[1px]">
          {saving ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </form>
      {status && !status.meilisearch.ok ? (
        <p className="text-destructive text-xs wrap-break-word">
          {status.meilisearch.error}
        </p>
      ) : null}
    </Section>
  );
}

function ProviderEditor({
  provider,
  isDefault,
  onSaved,
}: {
  provider: PublicProvider;
  isDefault: boolean;
  onSaved: (settings: PublicSettings) => void;
}) {
  const { t } = useI18n();
  const listId = useId();
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [model, setModel] = useState(provider.model);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "models" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form per provider
    setApiKey("");
    setBaseURL(provider.baseURL);
    setModel(provider.model);
    setModels([]);
    setResult(null);
  }, [provider.id, provider.baseURL, provider.model]);

  const dirty =
    Boolean(apiKey) || baseURL !== provider.baseURL || model !== provider.model;

  const persist = async () => {
    const saved = await saveSettings({
      llm: {
        providers: {
          [provider.id]: {
            apiKey: apiKey || undefined,
            baseURL: baseURL === provider.defaultBaseURL ? null : baseURL,
            model: model === provider.defaultModel ? null : model,
          },
        },
      },
    });
    setApiKey("");
    onSaved(saved);
    return saved;
  };

  const run = async (kind: "save" | "models" | "test") => {
    setBusy(kind);
    setResult(null);
    try {
      if (dirty || kind === "save") await persist();
      if (kind === "save")
        toast.add({ title: t("settings.saved"), description: provider.name });
      if (kind === "models") {
        const { models } = await api<{ models: string[] }>(
          `/api/llm/models?provider=${encodeURIComponent(provider.id)}`,
        );
        setModels(models);
        setResult({
          ok: true,
          text: t("settings.models", { count: models.length }),
        });
      }
      if (kind === "test") {
        const response = await api<{ latencyMs: number; model: string }>(
          "/api/llm/test",
          {
            method: "POST",
            body: jsonBody({ provider: provider.id, model }),
          },
        );
        setResult({
          ok: true,
          text: t("settings.testOk", {
            ms: response.latencyMs,
            model: response.model,
          }),
        });
      }
    } catch (error) {
      setResult({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const clearKey = async () => {
    try {
      onSaved(
        await saveSettings({
          llm: { providers: { [provider.id]: { apiKey: null } } },
        }),
      );
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    }
  };

  const makeDefault = async () => {
    try {
      onSaved(await saveSettings({ llm: { active: provider.id } }));
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{provider.name}</h3>
        <Badge variant={provider.configured ? "success" : "outline"}>
          {provider.configured
            ? t("settings.configured")
            : t("settings.notConfigured")}
        </Badge>
        {isDefault ? (
          <Badge>
            <StarIcon />
            {t("settings.default")}
          </Badge>
        ) : provider.configured ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => void makeDefault()}
          >
            {t("settings.setDefault")}
          </Button>
        ) : null}
        {provider.keyUrl ? (
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs"
          >
            {t("settings.getKey")}
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run("save");
        }}
      >
        <Field
          label={`${t("settings.apiKey")}${provider.keyRequired ? "" : ` (${t("common.optional")})`}`}
          hint={
            provider.hasKey ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{provider.keyHint}</span>
                {provider.keySource === "env" ? (
                  <span>{t("settings.fromEnv")}</span>
                ) : null}
                {provider.keySource === "settings" ? (
                  <button
                    type="button"
                    className="underline underline-offset-3"
                    onClick={() => void clearKey()}
                  >
                    {t("settings.clearKey")}
                  </button>
                ) : null}
              </span>
            ) : undefined
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={provider.hasKey ? t("settings.keepKey") : "sk-…"}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <Field label={t("settings.baseURL")}>
          <Input
            value={baseURL}
            placeholder="https://…/v1"
            onChange={(event) => setBaseURL(event.target.value)}
          />
        </Field>
        <Field label={t("settings.model")}>
          <div className="flex gap-2">
            <Input
              list={listId}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <datalist id={listId}>
              {models.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run("models")}
            >
              {busy === "models" ? <Spinner /> : <ListIcon />}
              <span className="hidden sm:inline">
                {t("settings.fetchModels")}
              </span>
            </Button>
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy !== null}>
            {busy === "save" ? <Spinner /> : null}
            {t("common.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void run("test")}
          >
            {busy === "test" ? <Spinner /> : <PlugZapIcon />}
            {t("settings.test")}
          </Button>
          {result ? (
            <span
              role="status"
              className={cn(
                "text-xs wrap-break-word",
                result.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-destructive",
              )}
            >
              {result.text}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function LlmSettings({
  settings,
  onSaved,
}: {
  settings: PublicSettings["llm"];
  onSaved: (settings: PublicSettings) => void;
}) {
  const { t } = useI18n();
  const { refreshStatus } = useWorkspace();
  const [selected, setSelected] = useState<string>(
    settings.active ?? settings.providers[0].id,
  );
  const provider =
    settings.providers.find((item) => item.id === selected) ??
    settings.providers[0];

  const groups = useMemo(
    () =>
      (["global", "cn", "local"] as const).map((group) => ({
        group,
        providers: settings.providers.filter((item) => item.group === group),
      })),
    [settings.providers],
  );

  return (
    <Section title={t("settings.llm")} description={t("settings.llm.desc")}>
      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="flex flex-col gap-3" aria-label={t("settings.llm")}>
          {groups.map(({ group, providers }) => (
            <div key={group} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground px-2 text-xs font-medium">
                {t(`settings.group.${group}`)}
              </span>
              {providers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={item.id === provider.id ? "true" : undefined}
                  onClick={() => setSelected(item.id)}
                  className="hover:bg-muted aria-[current=true]:bg-muted flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      item.configured
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.id === settings.active ? (
                    <StarIcon className="text-muted-foreground size-3 shrink-0" />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <ProviderEditor
          provider={provider}
          isDefault={provider.id === settings.active}
          onSaved={(next) => {
            onSaved(next);
            void refreshStatus();
          }}
        />
      </div>
    </Section>
  );
}

const notifyError = (title: string, error: unknown) =>
  toast.add({ title, description: errorMessage(error), type: "error" });

/* ----------------------------------------------------------- connections */

const EMPTY_CONNECTION = { id: "", name: "", host: "", apiKey: "" };

function ConnectionSettings({
  settings,
  onSaved,
}: {
  settings: PublicSettings["connections"];
  onSaved: (settings: PublicSettings) => void;
}) {
  const { t } = useI18n();
  const { connections: statuses, refreshKbs } = useWorkspace();
  const [form, setForm] = useState(EMPTY_CONNECTION);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const extra = settings.filter((connection) => !connection.builtin);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await saveSettings({
          connections: {
            upsert: [
              {
                id: form.id.trim(),
                name: form.name.trim() || undefined,
                host: form.host.trim(),
                apiKey: form.apiKey ? form.apiKey : undefined,
              },
            ],
          },
        }),
      );
      setForm(EMPTY_CONNECTION);
      setEditing(false);
      await refreshKbs();
      toast.add({ title: t("settings.saved") });
    } catch (error) {
      notifyError(t("common.error"), error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(t("conn.removeConfirm", { name }))) return;
    try {
      onSaved(await saveSettings({ connections: { remove: [id] } }));
      await refreshKbs();
    } catch (error) {
      notifyError(t("common.error"), error);
    }
  };

  return (
    <Section title={t("conn.title")} description={t("conn.desc")}>
      {extra.length ? (
        <ul className="divide-y rounded-lg border">
          {extra.map((connection) => {
            const status = statuses.find((item) => item.id === connection.id);
            return (
              <li
                key={connection.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {connection.name}
                    <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">
                      {connection.id}
                    </span>
                  </span>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {connection.host}
                    {connection.keyHint ? ` · ${connection.keyHint}` : ""}
                  </span>
                </div>
                {status ? (
                  status.ok ? (
                    <Badge variant="success">
                      <CheckIcon />
                      {t("conn.ok")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" title={status.error}>
                      <CircleAlertIcon />
                      {t("conn.down")}
                    </Badge>
                  )
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${t("common.edit")} ${connection.name}`}
                  onClick={() => {
                    setForm({
                      id: connection.id,
                      name: connection.name,
                      host: connection.host,
                      apiKey: "",
                    });
                    setEditing(true);
                  }}
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${t("conn.remove")} ${connection.name}`}
                  onClick={() => void remove(connection.id, connection.name)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <form
        className="grid items-end gap-3 sm:grid-cols-[8rem_1fr_1.4fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t("conn.id")}>
          <Input
            value={form.id}
            required
            readOnly={editing}
            pattern="[a-z0-9][a-z0-9_\-]*"
            placeholder="cloud"
            className="font-mono text-xs md:text-xs"
            onChange={(event) => setForm({ ...form, id: event.target.value })}
          />
        </Field>
        <Field label={t("conn.name")}>
          <Input
            value={form.name}
            placeholder="Meilisearch Cloud"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label={t("conn.host")}>
          <Input
            value={form.host}
            required={!editing}
            placeholder="https://ms-xxxx.meilisearch.io"
            onChange={(event) => setForm({ ...form, host: event.target.value })}
          />
        </Field>
        <Field label={t("settings.apiKey")}>
          <Input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            placeholder={editing ? t("settings.keepKey") : t("common.optional")}
            onChange={(event) =>
              setForm({ ...form, apiKey: event.target.value })
            }
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !form.id.trim()}>
            {saving ? <Spinner /> : editing ? null : <PlusIcon />}
            {editing ? t("common.save") : t("conn.add")}
          </Button>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setForm(EMPTY_CONNECTION);
                setEditing(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
      </form>
      <p className="text-muted-foreground text-xs">{t("conn.hint")}</p>
    </Section>
  );
}

/* -------------------------------------------------------------- embedding */

type BuiltinStatus = {
  state:
    "missing" | "downloading" | "downloaded" | "loading" | "ready" | "error";
  file: string;
  path: string;
  url: string;
  downloadedBytes: number;
  totalBytes: number | null;
  gpu: string | false | null;
  error: string | null;
};

type EmbeddingStatus = {
  engine: EmbeddingEngine;
  model: string;
  builtin: BuiltinStatus;
};

const MODEL_SOURCES: { value: ModelSource; label: string }[] = [
  { value: "huggingface", label: "Hugging Face" },
  { value: "hf-mirror", label: "hf-mirror.com" },
  { value: "modelscope", label: "ModelScope 魔搭" },
  { value: "custom", label: "Custom" },
];

function BuiltinState({ status }: { status: BuiltinStatus }) {
  const { t } = useI18n();
  const pct =
    status.totalBytes && status.state === "downloading"
      ? `${Math.floor((status.downloadedBytes / status.totalBytes) * 100)}%`
      : `${(status.downloadedBytes / 1024 ** 2).toFixed(0)} MB`;
  const label =
    status.state === "downloading"
      ? t("emb.state.downloading", { pct })
      : status.state === "error"
        ? t("emb.state.error", { error: status.error ?? "" })
        : t(`emb.state.${status.state}`);
  const variant =
    status.state === "ready"
      ? "success"
      : status.state === "error"
        ? "destructive"
        : status.state === "missing"
          ? "outline"
          : "warning";
  return (
    <Badge variant={variant} className="max-w-full whitespace-normal">
      {status.state === "downloading" || status.state === "loading" ? (
        <Spinner className="size-3" />
      ) : null}
      {label}
      {status.state === "ready"
        ? ` · ${status.gpu ? status.gpu : "CPU"}`
        : null}
    </Badge>
  );
}

function EmbeddingSettings({
  settings,
  onSaved,
}: {
  settings: PublicSettings["embedding"];
  onSaved: (settings: PublicSettings) => void;
}) {
  const { t } = useI18n();
  const [engine, setEngine] = useState<EmbeddingEngine>(settings.engine);
  const [source, setSource] = useState<ModelSource>(settings.builtin.source);
  const [url, setUrl] = useState(
    settings.builtin.source === "custom" ? settings.builtin.url : "",
  );
  const [baseURL, setBaseURL] = useState(settings.remote.baseURL);
  const [model, setModel] = useState(settings.remote.model);
  const [apiKey, setApiKey] = useState("");
  const [instruction, setInstruction] = useState(settings.queryInstruction);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<EmbeddingStatus>("/api/embedding"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    // Async loader: state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const busy =
    status?.builtin.state === "downloading" ||
    status?.builtin.state === "loading";
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [busy, load]);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await saveSettings({
          embedding: {
            engine,
            source,
            url: source === "custom" ? url.trim() : null,
            baseURL: baseURL.trim() || null,
            model: model.trim() || null,
            apiKey: apiKey ? apiKey : undefined,
            queryInstruction: instruction,
          },
        }),
      );
      setApiKey("");
      await load();
      toast.add({ title: t("settings.saved") });
    } catch (error) {
      notifyError(t("common.error"), error);
    } finally {
      setSaving(false);
    }
  };

  const action = async (name: "download" | "load") => {
    try {
      await api("/api/embedding", {
        method: "POST",
        body: jsonBody({ action: name }),
      });
      await load();
    } catch (error) {
      notifyError(t("common.error"), error);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<{
        dimensions: number;
        latencyMs: number;
        similarity: number;
      }>("/api/embedding", {
        method: "POST",
        body: jsonBody({ action: "test" }),
      });
      setTestResult(
        t("emb.testOk", {
          dims: result.dimensions,
          ms: result.latencyMs,
          sim: result.similarity,
        }),
      );
      await load();
    } catch (error) {
      setTestResult(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const builtin = status?.builtin;

  return (
    <Section
      title={t("emb.engineTitle")}
      description={t("emb.engine.desc")}
      actions={
        status ? (
          <span className="text-muted-foreground font-mono text-xs">
            {status.model}
          </span>
        ) : null
      }
    >
      <Segmented<EmbeddingEngine>
        value={engine}
        onChange={setEngine}
        options={[
          { value: "builtin", label: t("emb.engine.builtin") },
          { value: "remote", label: t("emb.engine.remote") },
        ]}
        className="flex-wrap"
      />

      {engine === "builtin" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {builtin ? <BuiltinState status={builtin} /> : <Spinner />}
            {builtin &&
            (builtin.state === "missing" || builtin.state === "error") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void action("download")}
              >
                <DownloadIcon />
                {t("emb.download")}
              </Button>
            ) : null}
            {builtin?.state === "downloaded" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void action("load")}
              >
                {t("emb.load")}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label={t("emb.modelSource")}>
              <NativeSelect
                value={source}
                onChange={(event) =>
                  setSource(event.target.value as ModelSource)
                }
              >
                {MODEL_SOURCES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.value === "custom"
                      ? t("emb.source.custom")
                      : item.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {source === "custom" ? (
              <Field label="URL">
                <Input
                  value={url}
                  placeholder={`https://…/${BUILTIN_EMBEDDING.file}`}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
            ) : (
              <Field label="URL">
                <Input
                  value={BUILTIN_EMBEDDING.urls[source]}
                  readOnly
                  className="text-muted-foreground font-mono text-xs md:text-xs"
                />
              </Field>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("emb.offline", { file: BUILTIN_EMBEDDING.file })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {REMOTE_EMBEDDING_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                size="xs"
                variant="outline"
                onClick={() => {
                  setBaseURL(preset.baseURL);
                  setModel(preset.model);
                }}
              >
                {preset.name}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("settings.baseURL")}>
              <Input
                value={baseURL}
                placeholder="http://127.0.0.1:11434/v1"
                onChange={(event) => setBaseURL(event.target.value)}
              />
            </Field>
            <Field label={t("emb.model")}>
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </Field>
            <Field
              label={t("emb.apiKey")}
              hint={settings.remote.keyHint ?? undefined}
            >
              <Input
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={
                  settings.remote.hasKey
                    ? t("emb.apiKey.keep")
                    : t("common.optional")
                }
                onChange={(event) => setApiKey(event.target.value)}
              />
            </Field>
          </div>
          <p className="text-muted-foreground text-xs">
            {t("emb.remote.hint")}
          </p>
        </div>
      )}

      <Field label={t("emb.instruction")} hint={t("emb.instruction.hint")}>
        <Textarea
          rows={2}
          value={instruction}
          placeholder={DEFAULT_QUERY_INSTRUCTION}
          onChange={(event) => setInstruction(event.target.value)}
          className="font-mono text-xs md:text-xs"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner /> : null}
          {t("common.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={testing}
          onClick={() => void test()}
        >
          {testing ? <Spinner /> : <PlugZapIcon />}
          {t("emb.test")}
        </Button>
        {testResult ? (
          <span className="text-muted-foreground text-xs wrap-break-word">
            {testResult}
          </span>
        ) : null}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- ocr */

type OcrStatus = PublicSettings["ocr"] & {
  state:
    | "disabled"
    | "missing"
    | "downloading"
    | "downloaded"
    | "loading"
    | "ready"
    | "error";
  installed: { model: string; source: string; installedAt: string } | null;
  progress: {
    source: string | null;
    file: string | null;
    downloaded: number;
    total: number | null;
  };
  error: string | null;
};

function OcrState({ status }: { status: OcrStatus }) {
  const { t } = useI18n();
  const { progress } = status;
  const amount = progress.total
    ? `${Math.floor((progress.downloaded / progress.total) * 100)}%`
    : `${(progress.downloaded / 1024 ** 2).toFixed(1)} MB`;
  const label =
    status.state === "downloading"
      ? t("ocr.state.downloading", {
          source: progress.source
            ? t(`ocr.source.${progress.source}` as MessageKey)
            : "",
          pct: amount,
        })
      : status.state === "error"
        ? t("emb.state.error", { error: status.error ?? "" })
        : t(`ocr.state.${status.state}` as MessageKey);
  const variant =
    status.state === "ready"
      ? "success"
      : status.state === "error"
        ? "destructive"
        : status.state === "missing" || status.state === "disabled"
          ? "outline"
          : "warning";
  return (
    <Badge variant={variant} className="max-w-full whitespace-normal">
      {status.state === "downloading" || status.state === "loading" ? (
        <Spinner className="size-3" />
      ) : null}
      {label}
    </Badge>
  );
}

function OcrSettings({
  settings,
  onSaved,
}: {
  settings: PublicSettings["ocr"];
  onSaved: (settings: PublicSettings) => void;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [model, setModel] = useState<OcrModelId>(settings.model);
  const [source, setSource] = useState<OcrSource>(settings.source);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [pypiIndex, setPypiIndex] = useState(settings.pypiIndex);
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<OcrStatus>("/api/ocr"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    // Async loader: state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const busy = status?.state === "downloading" || status?.state === "loading";
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [busy, load]);

  const dirty =
    enabled !== settings.enabled ||
    model !== settings.model ||
    source !== settings.source ||
    baseUrl !== settings.baseUrl ||
    pypiIndex !== settings.pypiIndex;

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await saveSettings({
          ocr: {
            enabled,
            model,
            source,
            baseUrl: baseUrl.trim() || null,
            pypiIndex: pypiIndex.trim() || null,
          },
        }),
      );
      await load();
      toast.add({ title: t("settings.saved") });
    } catch (error) {
      notifyError(t("common.error"), error);
    } finally {
      setSaving(false);
    }
  };

  const action = async (name: "download" | "load") => {
    try {
      setStatus(
        await api<OcrStatus>("/api/ocr", {
          method: "POST",
          body: jsonBody({ action: name }),
        }),
      );
      setTimeout(() => void load(), 300);
    } catch (error) {
      notifyError(t("common.error"), error);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<{ text: string; latencyMs: number }>(
        "/api/ocr",
        { method: "POST", body: jsonBody({ action: "test" }) },
      );
      setTestResult(
        t("ocr.testOk", {
          ms: result.latencyMs,
          text: result.text.replace(/\s+/g, " "),
        }),
      );
      await load();
    } catch (error) {
      setTestResult(errorMessage(error));
      await load();
    } finally {
      setTesting(false);
    }
  };

  const modelInfo = OCR_MODELS.find((item) => item.id === model);
  const sources: OcrSource[] = [...OCR_SOURCES, "custom"];

  return (
    <Section
      title={t("ocr.title")}
      description={t("ocr.desc")}
      actions={status ? <OcrState status={status} /> : <Spinner />}
    >
      <CheckField checked={enabled} onChange={setEnabled}>
        {t("ocr.enabled")}
      </CheckField>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ocr.model")}>
          <NativeSelect
            value={model}
            disabled={!enabled}
            onChange={(event) => setModel(event.target.value as OcrModelId)}
          >
            {OCR_MODELS.map((item) => (
              <option key={item.id} value={item.id}>
                {t(`ocr.model.${item.id}` as MessageKey)} · ~{item.sizeMb} MB
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("ocr.source")}>
          <NativeSelect
            value={source}
            disabled={!enabled}
            onChange={(event) => setSource(event.target.value as OcrSource)}
          >
            {sources.map((item) => (
              <option
                key={item}
                value={item}
                disabled={
                  item !== "auto" && !modelInfo?.sources.includes(item as never)
                }
              >
                {t(`ocr.source.${item}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {source === "custom" ? (
        <Field label={t("ocr.baseUrl")} hint={t("ocr.baseUrl.hint")}>
          <Input
            value={baseUrl}
            placeholder="https://example.com/ppu-paddle-ocr-models"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>
      ) : null}
      {source === "pypi" || source === "auto" ? (
        <Field label={t("ocr.pypiIndex")} hint={t("ocr.pypiIndex.hint")}>
          <Input
            value={pypiIndex}
            placeholder="https://pypi.org/simple"
            onChange={(event) => setPypiIndex(event.target.value)}
          />
        </Field>
      ) : null}
      {status?.installed ? (
        <p className="text-muted-foreground text-xs">
          {t("ocr.installed", {
            source: t(`ocr.source.${status.installed.source}` as MessageKey),
            time: new Date(status.installed.installedAt).toLocaleString(),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? <Spinner /> : null}
          {t("common.save")}
        </Button>
        {status &&
        !dirty &&
        (status.state === "missing" || status.state === "error") ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void action("download")}
          >
            <DownloadIcon />
            {t("ocr.download", { size: modelInfo?.sizeMb ?? "" })}
          </Button>
        ) : null}
        {status && !dirty && status.state === "downloaded" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void action("load")}
          >
            {t("emb.load")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={testing || dirty || !enabled || busy}
          onClick={() => void test()}
        >
          {testing ? <Spinner /> : <PlugZapIcon />}
          {t("emb.test")}
        </Button>
        {testResult ? (
          <span className="text-muted-foreground text-xs wrap-break-word">
            {testResult}
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">{t("ocr.offline")}</p>
    </Section>
  );
}

function Appearance() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <Section title={t("settings.appearance")}>
      <div className="flex flex-wrap gap-6">
        <Field group label={t("settings.language")}>
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: "zh", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
          />
        </Field>
        <Field group label={t("settings.theme")}>
          <Segmented<Theme>
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: t("theme.system") },
              { value: "light", label: t("theme.light") },
              { value: "dark", label: t("theme.dark") },
            ]}
          />
        </Field>
      </div>
    </Section>
  );
}

export function SettingsView() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PublicSettings>("/api/settings")
      .then(setSettings)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);

  return (
    <Page title={t("settings.title")}>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {settings ? (
        <>
          <MeilisearchSettings
            settings={settings.meilisearch}
            onSaved={setSettings}
          />
          <ConnectionSettings
            settings={settings.connections}
            onSaved={setSettings}
          />
          <LlmSettings settings={settings.llm} onSaved={setSettings} />
          <EmbeddingSettings
            settings={settings.embedding}
            onSaved={setSettings}
          />
          <OcrSettings settings={settings.ocr} onSaved={setSettings} />
          <Appearance />
        </>
      ) : !error ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      ) : null}
    </Page>
  );
}
