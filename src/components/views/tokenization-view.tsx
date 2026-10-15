"use client";

import {
  BookPlusIcon,
  CircleAlertIcon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";
import type { LocalizedAttribute, Settings } from "meilisearch";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { Page, RequireIndex, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { LOCALES, guessLang, guessLocale } from "@/lib/cjk";
import { api, errorMessage, jsonBody, waitForTask } from "@/lib/client";
import type { MessageKey } from "@/lib/i18n";
import { getSampleByIndex } from "@/lib/samples";
import {
  formatLines,
  formatLocalizedAttributes,
  formatSynonyms,
  parseLines,
  parseLocalizedAttributes,
  parseSynonyms,
} from "@/lib/text-formats";
import { cn } from "@/lib/utils";

/** Draft text for every tokenization-related setting. */
type Drafts = {
  dictionary: string;
  synonyms: string;
  stopWords: string;
  separatorTokens: string;
  nonSeparatorTokens: string;
  localizedAttributes: string;
};

type DraftKey = keyof Drafts;

const COMMON_ZH_STOP_WORDS = [
  "的",
  "了",
  "和",
  "是",
  "就",
  "都",
  "而",
  "及",
  "与",
  "着",
  "或",
  "一个",
  "没有",
  "我们",
  "你们",
  "他们",
  "这",
  "那",
  "之",
  "在",
];

const DEFAULT_PREVIEW =
  "南京市长江大桥是中国自行设计建造的第一座长江大桥。東京タワーから富士山が見えました。서울특별시는 한국의 수도입니다.";

function draftsFrom(settings: Settings): Drafts {
  return {
    dictionary: formatLines(settings.dictionary),
    synonyms: formatSynonyms(settings.synonyms),
    stopWords: formatLines(settings.stopWords),
    separatorTokens: formatLines(settings.separatorTokens),
    nonSeparatorTokens: formatLines(settings.nonSeparatorTokens),
    localizedAttributes: formatLocalizedAttributes(
      settings.localizedAttributes,
    ),
  };
}

type Parsed = {
  dictionary: string[];
  synonyms: Record<string, string[]>;
  stopWords: string[];
  separatorTokens: string[];
  nonSeparatorTokens: string[];
  localizedAttributes: LocalizedAttribute[];
  errors: Partial<Record<DraftKey, { line: number; text: string }[]>>;
};

function parseDrafts(drafts: Drafts): Parsed {
  const synonyms = parseSynonyms(drafts.synonyms);
  const localized = parseLocalizedAttributes(drafts.localizedAttributes);
  return {
    dictionary: parseLines(drafts.dictionary),
    synonyms: synonyms.synonyms,
    stopWords: parseLines(drafts.stopWords),
    separatorTokens: parseLines(drafts.separatorTokens),
    nonSeparatorTokens: parseLines(drafts.nonSeparatorTokens),
    localizedAttributes: localized.rules,
    errors: {
      synonyms: synonyms.errors,
      localizedAttributes: localized.errors,
    },
  };
}

/** Compare two values ignoring array order (Meilisearch sorts some lists). */
function sameSetting(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value
        .map(normalize)
        .map((item) => JSON.stringify(item))
        .sort();
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return value;
  };
  return (
    JSON.stringify(normalize(a ?? null)) ===
    JSON.stringify(normalize(b ?? null))
  );
}

const isEmpty = (value: unknown) =>
  value == null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && Object.keys(value as object).length === 0);

type PreviewToken = {
  text: string;
  start: number;
  end: number;
  kind: "word" | "stop" | "separator" | "unmatched";
  dictionary?: boolean;
};

function TokenChips({ tokens }: { tokens: PreviewToken[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      lang={guessLang(tokens.map((token) => token.text).join(""))}
    >
      {tokens.map((token, index) => {
        if (token.kind === "separator") {
          return token.text.trim() ? (
            <span
              key={index}
              className="text-muted-foreground/60 px-0.5 text-sm"
            >
              {token.text.trim()}
            </span>
          ) : null;
        }
        return (
          <span
            key={index}
            title={token.kind}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-sm leading-snug",
              token.kind === "word" && !token.dictionary && "bg-background",
              token.dictionary &&
                "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
              token.kind === "stop" &&
                "text-muted-foreground border-dashed line-through decoration-1",
              token.kind === "unmatched" &&
                "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
            )}
          >
            {token.text}
          </span>
        );
      })}
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  const items: [MessageKey, string][] = [
    ["tok.legend.word", "bg-background"],
    ["tok.legend.dictionary", "border-emerald-500/40 bg-emerald-500/10"],
    ["tok.legend.stop", "border-dashed"],
    ["tok.legend.unmatched", "border-amber-500/40 bg-amber-500/10"],
  ];
  return (
    <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
      {items.map(([label, className]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm border", className)} />
          {t(label)}
        </span>
      ))}
    </div>
  );
}

function LineEditor({
  id,
  value,
  onChange,
  hint,
  count,
  errors,
  rows = 12,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  count?: number;
  errors?: { line: number; text: string }[];
  rows?: number;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        className="field-sizing-fixed min-h-48 font-mono text-sm leading-relaxed md:text-sm"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
        {count !== undefined ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {t("tok.count", { count })}
          </span>
        ) : null}
      </div>
      {errors?.map((error) => (
        <p key={error.line} className="text-destructive text-xs">
          {t("tok.parseError", { line: error.line, text: error.text })}
        </p>
      ))}
    </div>
  );
}

function TokenizationBody() {
  const { t } = useI18n();
  const { indexUid, detail, refreshDetail } = useWorkspace();
  const saved = useMemo(
    () => (detail ? draftsFrom(detail.settings) : null),
    [detail],
  );
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [tab, setTab] = useState<string>("dictionary");
  const [saving, setSaving] = useState(false);

  // Load drafts whenever the index (or its saved settings) changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync drafts with server state
    setDrafts(saved);
  }, [saved]);

  const parsed = useMemo(() => (drafts ? parseDrafts(drafts) : null), [drafts]);

  const changes = useMemo(() => {
    if (!parsed || !detail) return {};
    const result: Settings = {};
    const keys = [
      "dictionary",
      "synonyms",
      "stopWords",
      "separatorTokens",
      "nonSeparatorTokens",
      "localizedAttributes",
    ] as const;
    for (const key of keys) {
      const next = parsed[key];
      const current = detail.settings[key];
      if (isEmpty(next) && isEmpty(current)) continue;
      if (!sameSetting(next, current)) {
        Object.assign(result, { [key]: next });
      }
    }
    return result;
  }, [parsed, detail]);

  const changeCount = Object.keys(changes).length;
  const hasErrors = Boolean(
    parsed && Object.values(parsed.errors).some((errors) => errors?.length),
  );

  const save = async () => {
    if (!indexUid || !changeCount) return;
    setSaving(true);
    try {
      const { taskUid } = await api<{ taskUid: number }>(
        `/api/indexes/${encodeURIComponent(indexUid)}/settings`,
        { method: "PATCH", body: jsonBody(changes) },
      );
      await waitForTask(taskUid);
      toast.add({ title: t("common.saved"), description: t("tok.saveHint") });
      await refreshDetail();
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

  const update = (key: DraftKey) => (value: string) =>
    setDrafts((current) => (current ? { ...current, [key]: value } : current));

  /* ---- preview ---- */
  const sample = indexUid ? getSampleByIndex(indexUid) : undefined;
  const [text, setText] = useState(sample?.previewText ?? DEFAULT_PREVIEW);
  const [locale, setLocale] = useState<string>("");
  const [preview, setPreview] = useState<{
    tokens: PreviewToken[];
    tookMs: number;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [selection, setSelection] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new index, new sample text
    setText(sample?.previewText ?? DEFAULT_PREVIEW);
  }, [sample]);

  // Default preview language: the first locale declared on the index.
  const declaredLocale = parsed?.localizedAttributes[0]?.locales[0] ?? "";
  const effectiveLocale = locale || declaredLocale || guessLocale(text) || "";

  const previewKey = parsed
    ? JSON.stringify([
        text,
        effectiveLocale,
        parsed.dictionary,
        parsed.stopWords,
        parsed.separatorTokens,
        parsed.nonSeparatorTokens,
      ])
    : null;

  useEffect(() => {
    if (!previewKey || !parsed || composing.current || !text.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreviewing(true);
      api<{ tokens: PreviewToken[]; tookMs: number }>("/api/tokenize", {
        method: "POST",
        signal: controller.signal,
        body: jsonBody({
          text,
          locale: effectiveLocale || null,
          dictionary: parsed.dictionary,
          stopWords: parsed.stopWords,
          separatorTokens: parsed.separatorTokens,
          nonSeparatorTokens: parsed.nonSeparatorTokens,
        }),
      })
        .then((result) => {
          setPreview(result);
          setPreviewError(null);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setPreviewError(errorMessage(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `previewKey` covers every input of the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const readSelection = () => {
    const element = textRef.current;
    if (!element) return;
    setSelection(
      element.value.slice(element.selectionStart, element.selectionEnd).trim(),
    );
  };

  const addSelection = () => {
    if (!selection || !drafts) return;
    const words = parseLines(drafts.dictionary);
    if (!words.includes(selection)) {
      update("dictionary")([...words, selection].join("\n"));
    }
    setTab("dictionary");
    toast.add({ title: t("tok.added", { word: selection }) });
  };

  if (!drafts || !parsed) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }

  const wordCount =
    preview?.tokens.filter((token) => token.kind === "word").length ?? 0;

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Section
        title={<span className="font-mono">{indexUid}</span>}
        description={t("tok.saveHint")}
        actions={
          <>
            {changeCount ? (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                {t("common.unsaved", { count: changeCount })}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.revert")}
              title={t("common.revert")}
              disabled={!changeCount || saving}
              onClick={() => setDrafts(saved)}
            >
              <RotateCcwIcon />
            </Button>
            <Button
              size="sm"
              disabled={!changeCount || hasErrors || saving}
              onClick={save}
            >
              {saving ? <Spinner /> : <SaveIcon />}
              {t("tok.save")}
            </Button>
          </>
        }
      >
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="dictionary">
              {t("tok.tab.dictionary")}
            </TabsTrigger>
            <TabsTrigger value="synonyms">{t("tok.tab.synonyms")}</TabsTrigger>
            <TabsTrigger value="stopWords">
              {t("tok.tab.stopWords")}
            </TabsTrigger>
            <TabsTrigger value="separators">
              {t("tok.tab.separators")}
            </TabsTrigger>
            <TabsTrigger value="languages">
              {t("tok.tab.languages")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dictionary">
            <LineEditor
              id="dictionary"
              value={drafts.dictionary}
              onChange={update("dictionary")}
              hint={t("tok.dictionary.hint")}
              count={parsed.dictionary.length}
              placeholder={"长江大桥\n混合搜索\nChatGPT"}
            />
          </TabsContent>
          <TabsContent value="synonyms">
            <LineEditor
              id="synonyms"
              value={drafts.synonyms}
              onChange={update("synonyms")}
              hint={t("tok.synonyms.hint")}
              count={Object.keys(parsed.synonyms).length}
              errors={parsed.errors.synonyms}
              placeholder={"电脑, 计算机, PC\n台湾, 臺灣\nAI => 人工智能"}
            />
          </TabsContent>
          <TabsContent value="stopWords" className="flex flex-col gap-2">
            <LineEditor
              id="stopWords"
              value={drafts.stopWords}
              onChange={update("stopWords")}
              hint={t("tok.stopWords.hint")}
              count={parsed.stopWords.length}
            />
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                update("stopWords")(
                  [
                    ...new Set([...parsed.stopWords, ...COMMON_ZH_STOP_WORDS]),
                  ].join("\n"),
                )
              }
            >
              {t("tok.stopWords.preset")}
            </Button>
          </TabsContent>
          <TabsContent value="separators" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="separatorTokens">
                {t("tok.separators.label")}
              </Label>
              <LineEditor
                id="separatorTokens"
                rows={5}
                value={drafts.separatorTokens}
                onChange={update("separatorTokens")}
                hint={t("tok.separators.hint")}
                count={parsed.separatorTokens.length}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nonSeparatorTokens">
                {t("tok.nonSeparators.label")}
              </Label>
              <LineEditor
                id="nonSeparatorTokens"
                rows={5}
                value={drafts.nonSeparatorTokens}
                onChange={update("nonSeparatorTokens")}
                hint={t("tok.nonSeparators.hint")}
                count={parsed.nonSeparatorTokens.length}
              />
            </div>
          </TabsContent>
          <TabsContent value="languages">
            <LineEditor
              id="localizedAttributes"
              rows={6}
              value={drafts.localizedAttributes}
              onChange={update("localizedAttributes")}
              hint={t("tok.languages.hint")}
              count={parsed.localizedAttributes.length}
              errors={parsed.errors.localizedAttributes}
              placeholder={"title, content => cmn\n*_ja => jpn"}
            />
          </TabsContent>
        </Tabs>
      </Section>

      <Section
        title={t("tok.preview.title")}
        description={t("tok.preview.desc")}
        className="order-first lg:sticky lg:top-0 lg:order-none lg:self-start"
        actions={
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {t("tok.preview.locale")}
            </span>
            <NativeSelect
              className="w-36"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              <option value="">
                {t("search.locale.auto")}
                {effectiveLocale && !locale ? ` (${effectiveLocale})` : ""}
              </option>
              {LOCALES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        }
      >
        <Textarea
          ref={textRef}
          value={text}
          maxLength={600}
          rows={4}
          lang={guessLang(text)}
          placeholder={t("tok.preview.placeholder")}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setText(event.currentTarget.value);
          }}
          onSelect={readSelection}
          className="text-base leading-relaxed md:text-base"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!selection || selection.length > 50}
            onClick={addSelection}
            title={t("tok.preview.selectHint")}
          >
            <BookPlusIcon />
            {t("tok.preview.addSelection")}
            {selection && selection.length <= 50 ? `「${selection}」` : ""}
          </Button>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums">
            {previewing ? <Spinner className="size-3" /> : null}
            {preview
              ? t("tok.preview.tokens", {
                  count: wordCount,
                  ms: preview.tookMs,
                })
              : null}
          </span>
        </div>
        {previewError ? (
          <p
            role="alert"
            className="text-destructive flex items-start gap-1.5 text-sm"
          >
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {previewError}
          </p>
        ) : null}
        {preview ? (
          <div
            className={cn(
              "flex flex-col gap-3 transition-opacity",
              previewing && "opacity-60",
            )}
          >
            <TokenChips tokens={preview.tokens} />
            <Legend />
          </div>
        ) : null}
        {!selection ? (
          <p className="text-muted-foreground text-xs">
            {t("tok.preview.selectHint")}
          </p>
        ) : null}
      </Section>
    </div>
  );
}

export function TokenizationView() {
  const { t } = useI18n();
  return (
    <Page
      title={t("tok.title")}
      description={t("tok.desc")}
      className="max-w-6xl"
    >
      <RequireIndex>
        <TokenizationBody />
      </RequireIndex>
    </Page>
  );
}
