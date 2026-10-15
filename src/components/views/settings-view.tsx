"use client";

import {
  CheckIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  ListIcon,
  PlugZapIcon,
  StarIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { useTheme } from "@/components/app-shell";
import { Page, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody } from "@/lib/client";
import type {
  PublicProvider,
  PublicSettings,
  SettingsPatch,
} from "@/lib/providers";

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
  const { status, refreshStatus, refreshIndexes } = useWorkspace();
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
      await Promise.all([refreshStatus(), refreshIndexes()]);
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
          <LlmSettings settings={settings.llm} onSaved={setSettings} />
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
