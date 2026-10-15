"use client";

import {
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type { Embedder } from "meilisearch";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { EmptyState, Page, RequireIndex, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody, waitForTask } from "@/lib/client";
import type { DisplayFields } from "@/lib/display";

type Source = "openAi" | "ollama" | "rest" | "huggingFace";

const PRESET_LABEL = {
  openAi: "emb.preset.openai",
  ollama: "emb.preset.ollama",
  rest: "emb.preset.rest",
  huggingFace: "emb.preset.huggingFace",
} as const;

/** OpenAI-compatible `/embeddings` endpoints (batched with `{{..}}`). */
const REST_VENDORS = [
  {
    id: "siliconflow",
    label: "硅基流动 bge-m3",
    url: "https://api.siliconflow.cn/v1/embeddings",
    model: "BAAI/bge-m3",
  },
  {
    id: "dashscope",
    label: "通义 text-embedding-v4",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
    model: "text-embedding-v4",
  },
  {
    id: "zhipu",
    label: "智谱 embedding-3",
    url: "https://open.bigmodel.cn/api/paas/v4/embeddings",
    model: "embedding-3",
  },
  {
    id: "jina",
    label: "Jina v3",
    url: "https://api.jina.ai/v1/embeddings",
    model: "jina-embeddings-v3",
  },
];

const restRequest = (model: string) =>
  JSON.stringify({ model, input: ["{{text}}", "{{..}}"] }, null, 2);
const REST_RESPONSE = JSON.stringify(
  { data: [{ embedding: "{{embedding}}" }, "{{..}}"] },
  null,
  2,
);

type Form = {
  name: string;
  source: Source;
  model: string;
  url: string;
  apiKey: string;
  dimensions: string;
  documentTemplate: string;
  documentTemplateMaxBytes: string;
  request: string;
  response: string;
};

function defaultTemplate(display: DisplayFields) {
  const lines = [];
  if (display.title) lines.push(`{{doc.${display.title}}}`);
  if (display.content) lines.push(`{{doc.${display.content}}}`);
  return lines.join("\n");
}

function presetForm(
  source: Source,
  display: DisplayFields,
  name = "default",
): Form {
  const base = {
    name,
    source,
    apiKey: "",
    dimensions: "",
    documentTemplate: defaultTemplate(display),
    documentTemplateMaxBytes: "2000",
    request: "",
    response: "",
  };
  switch (source) {
    case "openAi":
      return { ...base, model: "text-embedding-3-small", url: "" };
    case "ollama":
      return {
        ...base,
        model: "bge-m3",
        url: "http://localhost:11434/api/embed",
      };
    case "huggingFace":
      return { ...base, model: "BAAI/bge-small-zh-v1.5", url: "" };
    case "rest": {
      const vendor = REST_VENDORS[0];
      return {
        ...base,
        model: "",
        url: vendor.url,
        request: restRequest(vendor.model),
        response: REST_RESPONSE,
      };
    }
  }
}

function formFromEmbedder(
  name: string,
  embedder: Exclude<Embedder, null>,
): Form {
  const value = embedder as Record<string, unknown>;
  const text = (key: string) =>
    typeof value[key] === "string" || typeof value[key] === "number"
      ? String(value[key])
      : "";
  return {
    name,
    source: embedder.source as Source,
    model: text("model"),
    url: text("url"),
    apiKey: "",
    dimensions: text("dimensions"),
    documentTemplate: text("documentTemplate"),
    documentTemplateMaxBytes: text("documentTemplateMaxBytes"),
    request: value.request ? JSON.stringify(value.request, null, 2) : "",
    response: value.response ? JSON.stringify(value.response, null, 2) : "",
  };
}

function toEmbedder(form: Form): Embedder {
  const common: Record<string, unknown> = {
    documentTemplate: form.documentTemplate.trim() || undefined,
    documentTemplateMaxBytes: form.documentTemplateMaxBytes
      ? Number(form.documentTemplateMaxBytes)
      : undefined,
  };
  if (form.apiKey.trim()) common.apiKey = form.apiKey.trim();
  if (form.dimensions) common.dimensions = Number(form.dimensions);

  switch (form.source) {
    case "openAi":
      return {
        source: "openAi",
        model: form.model.trim() || undefined,
        url: form.url.trim() || undefined,
        ...common,
      } as Embedder;
    case "ollama":
      return {
        source: "ollama",
        model: form.model.trim(),
        url: form.url.trim() || undefined,
        ...common,
      } as Embedder;
    case "huggingFace":
      return {
        source: "huggingFace",
        model: form.model.trim(),
        documentTemplate: common.documentTemplate,
        documentTemplateMaxBytes: common.documentTemplateMaxBytes,
      } as Embedder;
    case "rest":
      return {
        source: "rest",
        url: form.url.trim(),
        request: JSON.parse(form.request),
        response: JSON.parse(form.response),
        ...common,
      } as Embedder;
  }
}

function EmbedderDialog({
  open,
  initial,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: Form;
  editing: boolean;
  onClose: () => void;
  onSubmit: (form: Form) => Promise<void>;
}) {
  const { t } = useI18n();
  const { detail } = useWorkspace();
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when reopened
    setForm(initial);
    setError(null);
  }, [initial, open]);

  const set = (patch: Partial<Form>) =>
    setForm((current) => ({ ...current, ...patch }));
  const display = detail?.display ?? {};

  const submit = async () => {
    if (!/^[A-Za-z0-9_-]+$/.test(form.name)) {
      setError(t("emb.name.hint"));
      return;
    }
    if (form.source === "rest") {
      try {
        JSON.parse(form.request);
        JSON.parse(form.response);
      } catch (reason) {
        setError(t("data.invalidJson", { message: errorMessage(reason) }));
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const showUrl = form.source !== "huggingFace";
  const showKey = form.source !== "huggingFace";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{editing ? t("emb.editTitle") : t("emb.add")}</DialogTitle>
        <DialogDescription>{t("emb.desc")}</DialogDescription>
        <div className="-mx-1 flex max-h-[65svh] flex-col gap-3 overflow-y-auto px-1 pb-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("emb.preset")}>
              <NativeSelect
                value={form.source}
                disabled={editing}
                onChange={(event) =>
                  setForm(
                    presetForm(
                      event.target.value as Source,
                      display,
                      form.name,
                    ),
                  )
                }
              >
                {(Object.keys(PRESET_LABEL) as Source[]).map((source) => (
                  <option key={source} value={source}>
                    {t(PRESET_LABEL[source])}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label={t("emb.name")}
              hint={editing ? undefined : t("emb.name.hint")}
            >
              <Input
                value={form.name}
                disabled={editing}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Field>
          </div>

          {form.source === "rest" ? (
            <Field group label={t("emb.restVendor")}>
              <div className="flex flex-wrap gap-1.5">
                {REST_VENDORS.map((vendor) => (
                  <Button
                    key={vendor.id}
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      set({
                        url: vendor.url,
                        request: restRequest(vendor.model),
                      })
                    }
                  >
                    {vendor.label}
                  </Button>
                ))}
              </div>
            </Field>
          ) : (
            <Field label={t("emb.model")}>
              <Input
                value={form.model}
                onChange={(event) => set({ model: event.target.value })}
              />
            </Field>
          )}

          {showUrl ? (
            <Field
              label={t("emb.url")}
              hint={form.source === "ollama" ? t("emb.dockerTip") : undefined}
            >
              <Input
                value={form.url}
                placeholder={
                  form.source === "openAi"
                    ? "https://api.openai.com/v1/embeddings"
                    : ""
                }
                onChange={(event) => set({ url: event.target.value })}
              />
            </Field>
          ) : null}

          {showKey ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label={t("emb.apiKey")}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  placeholder={
                    editing ? t("emb.apiKey.keep") : t("common.optional")
                  }
                  onChange={(event) => set({ apiKey: event.target.value })}
                />
              </Field>
              <Field label={t("emb.dimensions")}>
                <Input
                  type="number"
                  min={1}
                  value={form.dimensions}
                  placeholder={t("common.optional")}
                  onChange={(event) => set({ dimensions: event.target.value })}
                />
              </Field>
            </div>
          ) : null}

          {form.source === "rest" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("emb.request")}>
                <Textarea
                  rows={6}
                  spellCheck={false}
                  value={form.request}
                  onChange={(event) => set({ request: event.target.value })}
                  className="field-sizing-fixed font-mono text-xs md:text-xs"
                />
              </Field>
              <Field label={t("emb.response")}>
                <Textarea
                  rows={6}
                  spellCheck={false}
                  value={form.response}
                  onChange={(event) => set({ response: event.target.value })}
                  className="field-sizing-fixed font-mono text-xs md:text-xs"
                />
              </Field>
            </div>
          ) : null}

          <Field label={t("emb.template")} hint={t("emb.template.hint")}>
            <Textarea
              rows={3}
              spellCheck={false}
              value={form.documentTemplate}
              onChange={(event) =>
                set({ documentTemplate: event.target.value })
              }
              className="font-mono text-xs md:text-xs"
            />
          </Field>
          <Field label={t("emb.maxBytes")} hint={t("emb.maxBytes.hint")}>
            <Input
              type="number"
              min={1}
              className="w-40"
              value={form.documentTemplateMaxBytes}
              onChange={(event) =>
                set({ documentTemplateMaxBytes: event.target.value })
              }
            />
          </Field>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmbeddersBody() {
  const { t } = useI18n();
  const router = useRouter();
  const { indexUid, detail, refreshDetail, setPrefs } = useWorkspace();
  const [dialog, setDialog] = useState<{ form: Form; editing: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  const embedders = Object.entries(detail?.settings.embedders ?? {}).filter(
    (entry): entry is [string, Exclude<Embedder, null>] => entry[1] !== null,
  );
  const stats = detail?.stats;

  // Keep progress fresh while Meilisearch is (re)embedding.
  useEffect(() => {
    if (!stats?.isIndexing) return;
    const timer = setInterval(() => void refreshDetail(), 2000);
    return () => clearInterval(timer);
  }, [stats?.isIndexing, refreshDetail]);

  const patch = async (embedders: Record<string, Embedder>) => {
    const { taskUid } = await api<{ taskUid: number }>(
      `/api/indexes/${encodeURIComponent(indexUid ?? "")}/settings`,
      { method: "PATCH", body: jsonBody({ embedders }) },
    );
    return taskUid;
  };

  const track = (taskUid: number, label: string) => {
    void refreshDetail();
    waitForTask(taskUid)
      .then(() => toast.add({ title: t("task.succeeded"), description: label }))
      .catch((error) =>
        toast.add({
          title: t("task.failed"),
          description: errorMessage(error),
          type: "error",
        }),
      )
      .finally(() => void refreshDetail());
  };

  const submit = async (form: Form) => {
    const taskUid = await patch({ [form.name]: toEmbedder(form) });
    setDialog(null);
    toast.add({ title: t("emb.queued"), description: form.name });
    track(taskUid, form.name);
  };

  const remove = async (name: string) => {
    if (!window.confirm(t("emb.deleteConfirm", { name }))) return;
    setBusy(name);
    try {
      track(await patch({ [name]: null }), name);
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  if (!detail) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            setDialog({
              form: presetForm("ollama", detail.display),
              editing: false,
            })
          }
        >
          <PlusIcon />
          {t("emb.add")}
        </Button>
        <Button variant="outline" onClick={() => void refreshDetail()}>
          <RefreshCwIcon />
          {t("common.refresh")}
        </Button>
        {stats && embedders.length ? (
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {stats.isIndexing ? <Spinner className="size-3" /> : null}
            {t("emb.progress", {
              done: stats.numberOfEmbeddedDocuments,
              total: stats.numberOfDocuments,
            })}
          </span>
        ) : null}
      </div>

      {!embedders.length ? (
        <EmptyState
          icon={SparklesIcon}
          title={t("emb.empty")}
          description={t("emb.dockerTip")}
        />
      ) : null}

      {embedders.map(([name, embedder]) => {
        const value = embedder as Record<string, unknown>;
        return (
          <Section
            key={name}
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono">{name}</span>
                <Badge variant="outline">{embedder.source}</Badge>
              </span>
            }
            description={[value.model, value.url].filter(Boolean).join(" · ")}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPrefs({ embedder: name, mode: "hybrid" });
                    router.push("/search");
                  }}
                >
                  <SearchIcon />
                  {t("emb.useInSearch")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common.edit")}
                  onClick={() =>
                    setDialog({
                      form: formFromEmbedder(name, embedder),
                      editing: true,
                    })
                  }
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common.delete")}
                  disabled={busy === name}
                  onClick={() => void remove(name)}
                >
                  <Trash2Icon />
                </Button>
              </>
            }
          >
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-[auto_1fr]">
              {typeof value.dimensions === "number" ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("emb.dimensions")}
                  </dt>
                  <dd className="tabular-nums">{value.dimensions}</dd>
                </>
              ) : null}
              {typeof value.documentTemplate === "string" ? (
                <>
                  <dt className="text-muted-foreground">{t("emb.template")}</dt>
                  <dd>
                    <pre className="bg-muted rounded-md p-2 font-mono whitespace-pre-wrap">
                      {value.documentTemplate}
                    </pre>
                  </dd>
                </>
              ) : null}
              {typeof value.documentTemplateMaxBytes === "number" ? (
                <>
                  <dt className="text-muted-foreground">{t("emb.maxBytes")}</dt>
                  <dd className="tabular-nums">
                    {value.documentTemplateMaxBytes}
                  </dd>
                </>
              ) : null}
            </dl>
          </Section>
        );
      })}

      <EmbedderDialog
        open={dialog !== null}
        initial={dialog?.form ?? presetForm("ollama", detail.display)}
        editing={dialog?.editing ?? false}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />
    </div>
  );
}

export function EmbeddersView() {
  const { t } = useI18n();
  return (
    <Page title={t("emb.title")} description={t("emb.desc")}>
      <RequireIndex>
        <EmbeddersBody />
      </RequireIndex>
    </Page>
  );
}
