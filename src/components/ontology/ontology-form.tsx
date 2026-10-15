"use client";

import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ScanSearchIcon,
} from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/components/app-providers";
import { CheckField } from "@/components/kb-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage, jsonBody } from "@/lib/client";
import type {
  OntologyAuthType,
  OntologyInfo,
  OntologyInput,
  PublicOntology,
} from "@/lib/ontology/types";

type TestResult = {
  ok: boolean;
  error?: string | null;
  ontology?: OntologyInfo;
  ontologies?: OntologyInfo[];
  objectTypes?: number;
};

/** A connection id from a name; CJK names get a generated id. */
function idFrom(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return /^[a-z0-9]/.test(slug) ? slug : `onto-${Date.now().toString(36)}`;
}

const splitScopes = (value: string) =>
  value
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);

/** Create or edit an ontology connection. */
export function OntologyFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PublicOntology | null;
  onSaved: (connection: PublicOntology) => void;
}) {
  const { t } = useI18n();
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [id, setId] = useState(initial?.id ?? "");
  const [idTouched, setIdTouched] = useState(editing);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "https://");
  const [ontology, setOntology] = useState(initial?.ontology ?? "");
  const [auth, setAuth] = useState<OntologyAuthType>(initial?.auth ?? "token");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState(initial?.scopes?.join(" ") ?? "");
  const [allowFunctions, setAllowFunctions] = useState(
    initial?.allowFunctions ?? true,
  );
  const [allowActions, setAllowActions] = useState(
    initial?.allowActions ?? false,
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const effectiveId = idTouched ? id : idFrom(name || "ontology");
  const input = (overrides: Partial<OntologyInput> = {}): OntologyInput => ({
    id: effectiveId,
    name: name.trim() || effectiveId,
    description,
    baseUrl,
    ontology,
    auth,
    token: token || undefined,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    scopes: splitScopes(scopes),
    allowFunctions,
    allowActions,
    ...overrides,
  });

  const test = async (overrides: Partial<OntologyInput> = {}) => {
    setTesting(true);
    setResult(null);
    try {
      setResult(
        await api<TestResult>("/api/ontology/test", {
          method: "POST",
          body: jsonBody(input(overrides)),
        }),
      );
    } catch (error) {
      setResult({ ok: false, error: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { connection } = await api<{ connection: PublicOntology }>(
        "/api/ontology",
        { method: "POST", body: jsonBody(input()) },
      );
      toast.add({ title: t("onto.form.saved"), type: "success" });
      onSaved(connection);
      onOpenChange(false);
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

  const keepHint = (field: "token" | "secret") =>
    editing &&
    initial?.tokenHint &&
    initial.auth === (field === "token" ? "token" : "oauth")
      ? t("onto.form.keep", { hint: initial.tokenHint })
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>
          {editing ? t("onto.form.title.edit") : t("onto.form.title.create")}
        </DialogTitle>
        <DialogDescription>{t("onto.form.desc")}</DialogDescription>
        <form
          className="-mx-1 flex max-h-[65svh] flex-col gap-4 overflow-y-auto px-1 pb-1"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("onto.form.name")}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Foundry"
              />
            </Field>
            <Field label={t("onto.form.id")} hint={t("onto.form.id.hint")}>
              <Input
                value={effectiveId}
                disabled={editing}
                className="font-mono"
                onChange={(event) => {
                  setIdTouched(true);
                  setId(event.target.value.trim());
                }}
              />
            </Field>
          </div>
          <Field label={t("onto.form.baseUrl")}>
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://example.palantirfoundry.com"
              className="font-mono"
              inputMode="url"
            />
          </Field>
          <Field label={t("onto.form.auth")} group>
            <Segmented
              aria-label={t("onto.form.auth")}
              value={auth}
              onChange={setAuth}
              options={[
                { value: "token", label: t("onto.auth.token") },
                { value: "oauth", label: t("onto.auth.oauth") },
              ]}
            />
          </Field>
          {auth === "token" ? (
            <Field
              label={t("onto.form.token")}
              hint={keepHint("token") ?? t("onto.form.token.hint")}
            >
              <Input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="font-mono"
              />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("onto.form.clientId")}>
                <Input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field
                label={t("onto.form.clientSecret")}
                hint={keepHint("secret")}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  className="font-mono"
                />
              </Field>
              <Field
                label={t("onto.form.scopes")}
                hint={t("onto.form.scopes.hint")}
                className="sm:col-span-2"
              >
                <Input
                  value={scopes}
                  onChange={(event) => setScopes(event.target.value)}
                  placeholder="api:use-ontologies-read api:read-data"
                  className="font-mono"
                />
              </Field>
            </div>
          )}
          <Field
            label={t("onto.form.ontology")}
            hint={t("onto.form.ontology.hint")}
          >
            <div className="flex gap-2">
              <Input
                value={ontology}
                onChange={(event) => setOntology(event.target.value)}
                placeholder="ri.ontology.main.ontology.…"
                className="min-w-0 flex-1 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                disabled={testing}
                onClick={() => void test({ ontology: "" })}
              >
                <ScanSearchIcon />
                {t("onto.form.detect")}
              </Button>
            </div>
          </Field>
          {result?.ontologies?.length && !result.ok ? (
            <NativeSelect
              aria-label={t("onto.form.pick")}
              value=""
              onChange={(event) => {
                setOntology(event.target.value);
                void test({ ontology: event.target.value });
              }}
            >
              <option value="">{t("onto.form.pick")}</option>
              {result.ontologies.map((item) => (
                <option key={item.rid} value={item.apiName}>
                  {item.displayName} · {item.apiName}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <Field
            label={t("onto.form.description")}
            hint={t("onto.form.description.hint")}
          >
            <Textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-2.5">
            <CheckField checked={allowFunctions} onChange={setAllowFunctions}>
              {t("onto.form.allowFunctions")}
            </CheckField>
            <CheckField
              checked={allowActions}
              onChange={setAllowActions}
              hint={t("onto.form.allowActions.hint")}
            >
              {t("onto.form.allowActions")}
            </CheckField>
          </div>
          {result && (result.ok || result.error) ? (
            <p
              role="status"
              className={
                result.ok
                  ? "flex items-start gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
                  : "text-destructive flex items-start gap-1.5 text-sm"
              }
            >
              {result.ok ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
              )}
              <span className="break-all">
                {result.ok
                  ? t("onto.form.testOk", {
                      name: result.ontology?.displayName ?? "",
                      count: result.objectTypes ?? 0,
                    })
                  : t("onto.form.testFail", { error: result.error ?? "" })}
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={testing}
              onClick={() => void test()}
            >
              {testing ? <Spinner /> : null}
              {t("onto.form.test")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
