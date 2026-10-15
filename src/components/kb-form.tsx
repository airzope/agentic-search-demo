"use client";

import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { kbPath, useI18n, useWorkspace } from "@/components/app-providers";
import { DirPicker } from "@/components/dir-picker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { SCALE_PRESETS } from "@/lib/kb/schema";
import type { JobInfo, KbConfig } from "@/lib/kb/types";
import type { MessageKey } from "@/lib/i18n";
import { BUILTIN_EMBEDDING } from "@/lib/providers";
import { LANGUAGE_PRESETS } from "@/lib/samples";
import { cn } from "@/lib/utils";

/** A labelled checkbox. */
export function CheckField({
  checked,
  onChange,
  disabled,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2 text-sm",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        type="checkbox"
        className="accent-primary mt-0.5 size-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span>{children}</span>
        {hint ? (
          <span className="text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export const splitList = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

/** An index uid derived from a name or folder; CJK names get a generated uid. */
function suggestUid(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .toLowerCase()
    .slice(0, 48);
  return /[a-z0-9]/.test(slug) ? slug : `kb_${Date.now().toString(36)}`;
}

const baseName = (dir: string) =>
  dir
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? "";

type Form = {
  connectionId: string;
  sourceType: "directory" | "managed";
  path: string;
  name: string;
  uid: string;
  uidTouched: boolean;
  description: string;
  language: string;
  embedding: boolean;
  dimensions: number;
  scale: "standard" | "large";
  chunkSize: string;
  chunkOverlap: string;
  include: string;
  exclude: string;
  ocrImages: boolean;
  ocrEmbedded: boolean;
  watch: boolean;
  maxFileSizeMb: string;
};

const INITIAL: Form = {
  connectionId: "local",
  sourceType: "directory",
  path: "",
  name: "",
  uid: "",
  uidTouched: false,
  description: "",
  language: "cmn",
  embedding: true,
  dimensions: SCALE_PRESETS.standard.dimensions,
  scale: "standard",
  chunkSize: "",
  chunkOverlap: "",
  include: "",
  exclude: "",
  ocrImages: true,
  ocrEmbedded: false,
  watch: true,
  maxFileSizeMb: "",
};

const optionalNumber = (value: string) =>
  value.trim() ? Number(value) : undefined;

/** Dialog to create a knowledge base from a local folder or for uploads. */
export function KbCreateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { connections, refreshKbs, setKbId, setScope, scope } = useWorkspace();
  const router = useRouter();
  const [form, setForm] = useState<Form>(INITIAL);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (next: Partial<Form>) =>
    setForm((current) => {
      const merged = { ...current, ...next };
      // Keep the uid in sync with the name until it is edited by hand.
      if (
        !merged.uidTouched &&
        (next.name !== undefined || next.path !== undefined)
      ) {
        const source = merged.name || baseName(merged.path);
        merged.uid = source ? suggestUid(source) : "";
      }
      return merged;
    });

  const pickDirectory = (dir: string) => {
    setPicking(false);
    patch({ path: dir, name: form.name || baseName(dir) });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const preset = LANGUAGE_PRESETS.find((item) => item.id === form.language);
      const options = {
        ocrImages: form.ocrImages,
        ocrEmbedded: form.ocrEmbedded,
        maxFileSizeMb: optionalNumber(form.maxFileSizeMb),
      };
      const result = await api<{ config: KbConfig; job: JobInfo | null }>(
        "/api/kb",
        {
          method: "POST",
          body: jsonBody({
            connectionId: form.connectionId,
            indexUid: form.uid.trim(),
            name: form.name.trim(),
            description: form.description.trim(),
            locales: preset?.locales ?? [],
            embedding: form.embedding,
            dimensions: form.dimensions,
            scale: form.scale,
            chunkSize: optionalNumber(form.chunkSize),
            chunkOverlap: optionalNumber(form.chunkOverlap),
            source:
              form.sourceType === "directory"
                ? {
                    type: "directory",
                    path: form.path.trim(),
                    include: splitList(form.include),
                    exclude: splitList(form.exclude),
                    watch: form.watch,
                    ...options,
                  }
                : { type: "managed", ...options },
          }),
        },
      );
      await refreshKbs();
      setKbId(result.config.id);
      if (!scope.includes(result.config.id))
        setScope([...scope, result.config.id]);
      toast.add({ title: t("kb.registered", { name: result.config.name }) });
      setForm(INITIAL);
      onClose();
      router.push(`/kb/${encodeURIComponent(result.config.id)}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const preset = SCALE_PRESETS[form.scale];
  const ready =
    form.uid.trim() &&
    (form.sourceType === "managed" || form.path.trim()) &&
    !busy;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-xl">
          <DialogTitle>{t("kb.create")}</DialogTitle>
          <form
            id="kb-create"
            className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) void submit();
            }}
          >
            <Field label={t("kb.source")} group>
              <Segmented
                value={form.sourceType}
                onChange={(sourceType) => patch({ sourceType })}
                options={[
                  { value: "directory", label: t("kb.source.directory") },
                  { value: "managed", label: t("kb.source.managed") },
                ]}
              />
            </Field>

            {form.sourceType === "directory" ? (
              <Field label={t("kb.path")} group>
                <div className="flex gap-2">
                  <Input
                    aria-label={t("kb.path")}
                    value={form.path}
                    required
                    placeholder="/home/me/Documents/handbook  ·  D:\Docs"
                    className="font-mono text-xs md:text-xs"
                    onChange={(event) => patch({ path: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPicking(true)}
                  >
                    <FolderOpenIcon />
                    {t("kb.browse")}
                  </Button>
                </div>
              </Field>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("kb.name")}>
                <Input
                  value={form.name}
                  placeholder="产品手册"
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </Field>
              <Field label={t("kb.uid")} hint={t("kb.uid.hint")}>
                <Input
                  value={form.uid}
                  required
                  pattern="[A-Za-z0-9_\-]+"
                  className="font-mono text-xs md:text-xs"
                  onChange={(event) =>
                    patch({ uid: event.target.value, uidTouched: true })
                  }
                />
              </Field>
            </div>

            <Field label={t("kb.description")} hint={t("kb.description.hint")}>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("kb.connection")}>
                <NativeSelect
                  value={form.connectionId}
                  onChange={(event) =>
                    patch({ connectionId: event.target.value })
                  }
                >
                  {connections.map((connection) => (
                    <option
                      key={connection.id}
                      value={connection.id}
                      disabled={!connection.ok}
                    >
                      {connection.name}
                      {connection.ok ? "" : ` (${t("conn.down")})`}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("kb.language")}>
                <NativeSelect
                  value={form.language}
                  onChange={(event) => patch({ language: event.target.value })}
                >
                  {LANGUAGE_PRESETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(`data.lang.${item.id}` as MessageKey)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <CheckField
                checked={form.embedding}
                onChange={(embedding) => patch({ embedding })}
              >
                {t("kb.embedding")}
              </CheckField>
              <CheckField
                checked={form.ocrImages}
                onChange={(ocrImages) => patch({ ocrImages })}
              >
                {t("kb.ocrImages")}
              </CheckField>
              {form.sourceType === "directory" ? (
                <CheckField
                  checked={form.watch}
                  onChange={(watch) => patch({ watch })}
                >
                  {t("kb.watch")}
                </CheckField>
              ) : null}
            </div>

            <Collapsible className="group/advanced flex flex-col gap-3">
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground w-fit text-sm underline-offset-3 hover:underline">
                {t("kb.advancedOptions")}
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-3">
                <Field label={t("kb.scale")} group>
                  <Segmented
                    value={form.scale}
                    onChange={(scale) =>
                      patch({
                        scale,
                        dimensions: SCALE_PRESETS[scale].dimensions,
                      })
                    }
                    options={[
                      { value: "standard", label: t("kb.scale.standard") },
                      { value: "large", label: t("kb.scale.large") },
                    ]}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t("kb.dimensions")}>
                    <NativeSelect
                      value={String(form.dimensions)}
                      disabled={!form.embedding}
                      onChange={(event) =>
                        patch({ dimensions: Number(event.target.value) })
                      }
                    >
                      {BUILTIN_EMBEDDING.dimensionOptions.map((dims) => (
                        <option key={dims} value={dims}>
                          {dims}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("kb.chunkSize")}>
                    <Input
                      type="number"
                      min={200}
                      max={4000}
                      value={form.chunkSize}
                      placeholder={String(preset.chunkSize)}
                      onChange={(event) =>
                        patch({ chunkSize: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("kb.chunkOverlap")}>
                    <Input
                      type="number"
                      min={0}
                      max={1000}
                      value={form.chunkOverlap}
                      placeholder={String(preset.overlap)}
                      onChange={(event) =>
                        patch({ chunkOverlap: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <p className="text-muted-foreground -mt-1 text-xs">
                  {t("kb.dimensions.hint")}
                </p>
                {form.sourceType === "directory" ? (
                  <>
                    <Field label={t("kb.include")} hint={t("kb.include.hint")}>
                      <Input
                        value={form.include}
                        placeholder="pdf, docx, md"
                        onChange={(event) =>
                          patch({ include: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("kb.exclude")} hint={t("kb.exclude.hint")}>
                      <Input
                        value={form.exclude}
                        placeholder="drafts/**, *.bak"
                        onChange={(event) =>
                          patch({ exclude: event.target.value })
                        }
                      />
                    </Field>
                  </>
                ) : null}
                <div className="grid items-end gap-3 sm:grid-cols-2">
                  <Field label={t("kb.maxFileSize")}>
                    <Input
                      type="number"
                      min={1}
                      max={2048}
                      value={form.maxFileSizeMb}
                      placeholder="200"
                      onChange={(event) =>
                        patch({ maxFileSizeMb: event.target.value })
                      }
                    />
                  </Field>
                  <CheckField
                    checked={form.ocrEmbedded}
                    disabled={!form.ocrImages}
                    onChange={(ocrEmbedded) => patch({ ocrEmbedded })}
                  >
                    {t("kb.ocrEmbedded")}
                  </CheckField>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {error ? (
              <p className="text-destructive text-sm wrap-break-word">
                {error}
              </p>
            ) : null}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="kb-create" disabled={!ready}>
              {busy ? <Spinner /> : <PlusIcon />}
              {t("kb.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DirPicker
        open={picking}
        initialPath={form.path}
        onClose={() => setPicking(false)}
        onSelect={pickDirectory}
      />
    </>
  );
}

/** Start a sync job; returns the job or null after showing an error toast. */
export async function startKbSync(
  id: string,
  options: { force?: boolean; rebuild?: boolean },
  onError: (message: string) => void,
) {
  try {
    return await api<JobInfo>(`${kbPath(id)}/sync`, {
      method: "POST",
      body: jsonBody(options),
    });
  } catch (reason) {
    onError(errorMessage(reason));
    return null;
  }
}
