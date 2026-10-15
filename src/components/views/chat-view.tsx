"use client";

import { useChat } from "@ai-sdk/react";
import { MarkdownClient } from "@comark/react";
import breaks from "@comark/react/plugins/breaks";
import { DefaultChatTransport } from "ai";
import {
  BookOpenIcon,
  BotIcon,
  BrainCircuitIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  CornerDownRightIcon,
  FolderTreeIcon,
  HistoryIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type FormEvent,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import {
  OntologyToolStep,
  isOntologyStep,
} from "@/components/chat/ontology-steps";
import {
  SourceCard,
  SourceRow,
  SourceTile,
  SourcesContext,
  isToolPart,
  sourceOrigin,
  sourceTitle,
  useSources,
  type ToolPart,
} from "@/components/chat/sources";
import { VerificationPanel } from "@/components/chat/verification";
import { DocViewer, type DocTarget } from "@/components/doc-viewer";
import { KbScopePicker } from "@/components/kb-scope";
import { OntologyViewer } from "@/components/ontology/object-viewer";
import { EmptyState, RequireIndex } from "@/components/page";
import { SearchControls } from "@/components/search-controls";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { citedNumbers, linkCitations } from "@/lib/agent/citations";
import {
  collectSources,
  isOntologySource,
  type BrowseToolOutput,
  type ChatMessage,
  type ReadToolOutput,
  type SearchToolOutput,
  type Source,
  type Verification,
} from "@/lib/agent/types";
import {
  deleteChat,
  listChats,
  loadMessages,
  loadVerifications,
  newChatId,
  saveChat,
  saveVerification,
  type ChatSummary,
} from "@/lib/chat-store";
import { guessLang, isComposing } from "@/lib/cjk";
import {
  api,
  errorMessage,
  jsonBody,
  readStorage,
  writeStorage,
} from "@/lib/client";
import type { PublicSettings } from "@/lib/providers";
import { getSampleByIndex } from "@/lib/samples";
import { cn } from "@/lib/utils";

const PROVIDER_KEY = "cjk-studio.provider";
const DEEP_KEY = "cjk-studio.deep";
const CURRENT_KEY = "cjk-studio.chat";

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

/** `kbId~docId~chunk` → viewer target. */
function targetOf(ref: string, title?: string): DocTarget | null {
  const [kbId, docId, chunk] = ref.split("~");
  if (!kbId || !docId) return null;
  return {
    kbId,
    docId,
    chunk: chunk !== undefined && /^\d+$/.test(chunk) ? Number(chunk) : null,
    title,
  };
}

/* ------------------------------------------------------------ markdown */

const markdownPlugins = [breaks()];

const markdownClassName = cn(
  "[&_p]:mb-3 [&_p:last-child]:mb-0 [&_p]:whitespace-pre-wrap [&_li]:whitespace-pre-wrap",
  "[&_ol]:mb-3 [&_ol:last-child]:mb-0 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_ul]:mb-3 [&_ul:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1:first-child]:mt-0",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0",
  "[&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3:first-child]:mt-0",
  "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-3",
  "[&_code]:bg-muted [&_code]:rounded-sm [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:bg-muted [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:text-muted-foreground [&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-left",
  "[&_th]:bg-muted/50 [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_td]:border [&_td]:px-2 [&_td]:py-1.5",
);

function Citation({ n }: { n: number }) {
  const { t } = useI18n();
  const { sources, open } = useSources();
  const source = sources.get(n);
  return (
    <Popover>
      <PopoverTrigger
        className="bg-primary/10 text-primary hover:bg-primary/20 mx-px inline-flex h-4.5 min-w-4.5 -translate-y-px items-center justify-center rounded-full px-1 align-middle text-[11px] font-semibold tabular-nums no-underline"
        aria-label={`${t("chat.source")} ${n}`}
      >
        {n}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        {source ? <SourceCard source={source} /> : null}
        {source ? (
          <Button
            size="xs"
            variant="outline"
            className="mt-2"
            onClick={() => open(source)}
          >
            <BookOpenIcon />
            {source.kind === "object"
              ? t("onto.openObject")
              : isOntologySource(source)
                ? t("onto.openDetail")
                : t("chat.openSource")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Legacy citations from earlier versions: `[n](#doc-<ref>)`. */
function LegacyCitation({
  refId,
  children,
}: {
  refId: string;
  children: ReactNode;
}) {
  const { open } = useSources();
  return (
    <button
      type="button"
      className="bg-primary/10 text-primary mx-px inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 align-middle text-[11px] font-semibold"
      onClick={() => open({ n: 0, ref: refId })}
    >
      {children}
    </button>
  );
}

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (typeof href === "string" && href.startsWith("#cite-")) {
    return <Citation n={Number(href.slice(6))} />;
  }
  if (typeof href === "string" && href.startsWith("#doc-")) {
    return (
      <LegacyCitation refId={decodeURIComponent(href.slice(5))}>
        {children}
      </LegacyCitation>
    );
  }
  const external = typeof href === "string" && /^(https?:|mailto:)/i.test(href);
  return (
    <a
      href={href}
      {...props}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

function MarkdownTable({
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="mb-3 w-full max-w-full overflow-x-auto last:mb-0">
      <table {...props}>{children}</table>
    </div>
  );
}

const markdownComponents = {
  img: () => null,
  a: MarkdownLink,
  table: MarkdownTable,
};

function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  const { sources } = useSources();
  const value = useMemo(
    () => linkCitations(text, (n) => sources.has(n)),
    [text, sources],
  );
  return (
    <div
      lang={guessLang(text)}
      className="text-sm leading-relaxed wrap-break-word"
    >
      <MarkdownClient
        value={value}
        plugins={markdownPlugins}
        components={markdownComponents}
        streaming={streaming}
        className={markdownClassName}
      />
    </div>
  );
}

/* --------------------------------------------------------------- tools */

const joinQueries = (queries: unknown, lang: string) =>
  Array.isArray(queries)
    ? queries
        .map((query) => (lang === "zh" ? `「${query}」` : `“${query}”`))
        .join(" ")
    : "";

function ToolStep({ part }: { part: ToolPart }) {
  const { t, lang } = useI18n();
  const { open } = useSources();
  const done = part.state === "output-available";

  if (part.state === "output-error") {
    return (
      <Marker role="alert" className="text-destructive">
        <MarkerIcon>
          <CircleAlertIcon />
        </MarkerIcon>
        <MarkerContent className="line-clamp-2">{part.errorText}</MarkerContent>
      </Marker>
    );
  }

  if (isOntologyStep(part)) return <OntologyToolStep part={part} />;

  if (part.type === "tool-browse") {
    const input = (part.input ?? {}) as { branch?: string };
    const output = (part.output ?? {}) as Partial<BrowseToolOutput>;
    const branch = input.branch || "/";
    return (
      <Marker role="status">
        <MarkerIcon>
          <FolderTreeIcon />
        </MarkerIcon>
        <MarkerContent className={done ? undefined : "shimmer"}>
          {done
            ? t("chat.browsed", {
                branch,
                folders: output.folders?.length ?? 0,
                files: output.files?.length ?? 0,
              })
            : t("chat.browsing", { branch })}
        </MarkerContent>
      </Marker>
    );
  }

  if (part.type === "tool-read") {
    const output = (part.output ?? {}) as Partial<ReadToolOutput>;
    return (
      <Marker role="status">
        <MarkerIcon>
          <BookOpenIcon />
        </MarkerIcon>
        <MarkerContent className={done ? undefined : "shimmer"}>
          {done && output.ref ? (
            <button
              type="button"
              className="hover:text-foreground text-left underline-offset-3 hover:underline"
              onClick={() => open(output as Source)}
            >
              {t("chat.read", { title: output.title || output.path || "" })}
              <span className="ml-1 tabular-nums">[{output.n}]</span>
            </button>
          ) : (
            t("chat.reading")
          )}
        </MarkerContent>
      </Marker>
    );
  }

  const input = (part.input ?? {}) as { queries?: string[] };
  const queries = joinQueries(input.queries, lang);
  if (!done) {
    return (
      <Marker role="status">
        <MarkerIcon>
          <SearchIcon />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          {t("chat.searchingMulti", { queries })}
        </MarkerContent>
      </Marker>
    );
  }
  const results = (part.output as SearchToolOutput | undefined)?.results ?? [];
  const hits = results.flatMap((result) =>
    result.hits.filter((hit): hit is Source => !("duplicate" in hit)),
  );
  const notices = [
    ...new Set(
      results.flatMap((result) => [
        ...(result.warnings ?? []),
        ...(result.errors ?? []).map(
          (item) => `${item.scope}: ${item.message}`,
        ),
      ]),
    ),
  ];
  return (
    <Collapsible className="group w-full">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-sm">
        <SearchIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t("chat.searchedMulti", { queries, count: hits.length })}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="bg-muted/40 mt-2 flex flex-col gap-2 rounded-lg p-3 text-xs">
          {notices.map((notice) => (
            <li key={notice} className="text-amber-700 dark:text-amber-400">
              {notice}
            </li>
          ))}
          {hits.map((hit) => (
            <SourceRow key={hit.ref} source={hit} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Sources cited in one answer, plus the ones retrieved but not cited. */
function AnswerSources({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const { sources } = useSources();
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  const cited = citedNumbers(text, (n) => sources.has(n))
    .map((n) => sources.get(n)!)
    .filter(Boolean);
  const own = collectSources([message]);
  const uncited = [...own.values()].filter(
    (source) => !cited.some((item) => item.n === source.n),
  );
  if (!cited.length && !uncited.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {cited.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            {t("chat.sources", { count: cited.length })}
          </p>
          <ol className="grid gap-2 text-xs sm:grid-cols-2">
            {cited.map((source) => (
              <SourceTile key={source.n} source={source} />
            ))}
          </ol>
        </div>
      ) : null}
      {uncited.length ? (
        <Collapsible className="group">
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
            {t("chat.sources.more", { count: uncited.length })}
            <ChevronDownIcon className="size-3.5 transition-transform group-data-open:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 flex flex-col gap-2 text-xs">
              {uncited
                .sort((a, b) => a.n - b.n)
                .map((source) => (
                  <SourceRow key={source.n} source={source} />
                ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- chat */

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.trim() || /^<!DOCTYPE|^<html/i.test(message.trim())) {
    return "The request failed.";
  }
  return message;
}

/** Plain text of an answer with its numbered source list, for copying. */
function copyText(message: ChatMessage, sources: Map<number, Source>) {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
  const cited = citedNumbers(text, (n) => sources.has(n));
  if (!cited.length) return text;
  const list = cited
    .map((n) => {
      const source = sources.get(n)!;
      const origin = sourceOrigin(source);
      return `[${n}] ${sourceTitle(source)}${origin ? ` — ${origin}` : ""}`;
    })
    .join("\n");
  return `${text}\n\n${list}`;
}

function AssistantMessage({
  message,
  streaming,
  last,
  onRegenerate,
  verification,
  verifying,
  onVerify,
}: {
  message: ChatMessage;
  streaming: boolean;
  last: boolean;
  onRegenerate: () => void;
  verification?: Verification;
  verifying: boolean;
  onVerify: () => void;
}) {
  const { t } = useI18n();
  const { sources } = useSources();
  const hasText = message.parts.some(
    (part) => part.type === "text" && part.text.trim(),
  );
  const [copied, setCopied] = useState(false);
  const meta = message.metadata;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(message, sources));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(error),
        type: "error",
      });
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <AnswerText
              key={index}
              text={part.text}
              streaming={streaming && part.state === "streaming"}
            />
          );
        }
        if (part.type === "reasoning") {
          if (!part.text.trim()) return null;
          return (
            <Collapsible key={index} className="group">
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs">
                <BrainIcon className="size-3.5" />
                {t("chat.reasoning")}
                <ChevronDownIcon className="size-3.5 transition-transform group-data-open:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="text-muted-foreground mt-1.5 border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {part.text}
                </p>
              </CollapsibleContent>
            </Collapsible>
          );
        }
        if (part.type === "data-steer") {
          return (
            <div
              key={index}
              className="text-muted-foreground flex items-start gap-1.5 text-xs"
            >
              <CornerDownRightIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t("chat.steer.label")}：{part.data.text}
              </span>
            </div>
          );
        }
        if (isToolPart(part)) {
          return <ToolStep key={part.toolCallId} part={part} />;
        }
        return null;
      })}
      {!streaming ? <AnswerSources message={message} /> : null}
      {!streaming && verification ? (
        <VerificationPanel
          verification={verification}
          running={verifying}
          onRerun={onVerify}
        />
      ) : null}
      {!streaming ? (
        <div className="text-muted-foreground/80 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px]">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("chat.copy")}
            title={t("chat.copy")}
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
          {hasText && !verification ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={verifying}
              title={t("verify.title")}
              onClick={onVerify}
            >
              {verifying ? <Spinner /> : <ShieldCheckIcon />}
              {verifying ? t("verify.running") : t("verify.run")}
            </Button>
          ) : null}
          {last ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("chat.regenerate")}
              title={t("chat.regenerate")}
              onClick={onRegenerate}
            >
              <RotateCcwIcon />
            </Button>
          ) : null}
          {meta?.model ? (
            <span className="ml-1">
              {meta.provider} · {meta.model}
              {meta.deep ? ` · ${t("chat.deep")}` : null}
              {meta.usage && meta.usage.input + meta.usage.output > 0
                ? ` · ${t("chat.meta.tokens", { input: meta.usage.input, output: meta.usage.output })}`
                : null}
              {meta.durationMs
                ? ` · ${t("chat.meta.seconds", { s: (meta.durationMs / 1000).toFixed(1) })}`
                : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChatBody({
  chatId,
  initialMessages,
  providers,
  onSaved,
  history,
}: {
  chatId: string;
  initialMessages: ChatMessage[];
  providers: PublicSettings["llm"];
  onSaved: (chats: ChatSummary[]) => void;
  history: ReactNode;
}) {
  const { t } = useI18n();
  const { kbs, scope, prefs, ontologies, ontologyScope } = useWorkspace();
  const configured = providers.providers.filter(
    (provider) => provider.configured,
  );
  const [providerId, setProviderId] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [input, setInput] = useState("");
  const [opened, setOpened] = useState<DocTarget | null>(null);
  const [openedOntology, setOpenedOntology] = useState<Source | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<
    Record<string, Verification>
  >({});
  const [verifying, setVerifying] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage
    setProviderId(readStorage<string | null>(PROVIDER_KEY, null));
    setDeep(readStorage<boolean>(DEEP_KEY, false));
    setVerifications(loadVerifications(chatId));
  }, [chatId]);

  const scopeKbs = (kbs ?? []).filter((kb) => scope.includes(kb.id));
  const scopeOntologies = (ontologies ?? []).filter((item) =>
    ontologyScope.includes(item.id),
  );
  const activeProvider =
    configured.find((provider) => provider.id === providerId) ??
    configured.find((provider) => provider.id === providers.active) ??
    configured[0];

  const { messages, sendMessage, regenerate, status, error, stop } =
    useChat<ChatMessage>({ id: chatId, messages: initialMessages, transport });
  const busy = status === "submitted" || status === "streaming";

  // Save once a response settles.
  useEffect(() => {
    if (busy || !messages.length) return;
    onSaved(saveChat(chatId, messages, scope));
  }, [busy, messages, chatId, scope, onSaved]);

  const sources = useMemo(() => collectSources(messages), [messages]);
  const openSource = useCallback(
    (source: Source) => {
      if (isOntologySource(source)) {
        setOpenedOntology(source);
        return;
      }
      const target = targetOf(source.ref, source.title);
      if (target) setOpened(target);
    },
    [setOpened, setOpenedOntology],
  );
  const context = useMemo(
    () => ({ sources, open: openSource }),
    [sources, openSource],
  );

  const requestBody = () => ({
    kbs: scope,
    ontologies: scopeOntologies.map((item) => item.id),
    provider: activeProvider?.id,
    model: activeProvider?.model,
    search: prefs,
    deep,
  });

  const send = (text: string) => {
    const value = text.trim();
    if (!value || !activeProvider) return;
    setInput("");
    if (busy) {
      // pi agent steering: guidance joins the run after the current tool calls.
      void api<{ accepted: boolean }>("/api/chat/steer", {
        method: "POST",
        body: jsonBody({ id: chatId, text: value }),
      })
        .then(({ accepted }) => {
          if (!accepted) setQueued(value);
        })
        .catch(() => setQueued(value));
      return;
    }
    // Settings travel with each request, so switching model/scope applies immediately.
    void sendMessage({ text: value }, { body: requestBody() });
  };

  // A message typed while the run was ending is sent once it is done.
  useEffect(() => {
    if (busy || !queued) return;
    const text = queued;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume the queue
    setQueued(null);
    void sendMessage({ text }, { body: requestBody() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queued]);

  /** Check an answer claim by claim against the sources it cites. */
  const verify = async (messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    setVerifying(messageId);
    try {
      const result = await api<Verification>("/api/chat/verify", {
        method: "POST",
        body: jsonBody({
          messages: messages.slice(0, index + 1),
          messageId,
          provider: activeProvider?.id,
          model: activeProvider?.model,
        }),
      });
      setVerifications(saveVerification(chatId, result));
    } catch (reason) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(reason),
        type: "error",
      });
    } finally {
      setVerifying(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const sample = scopeKbs
    .filter((kb) => kb.connectionId === "local")
    .map((kb) => getSampleByIndex(kb.indexUid))
    .find(Boolean);
  const scopeNames = [
    ...scopeKbs.map((kb) => kb.name),
    ...scopeOntologies.map((item) => item.name),
  ];
  const scopeLabel =
    scopeNames.length === 1
      ? scopeNames[0]
      : scopeOntologies.length
        ? t("scope.countMixed", { count: scopeNames.length })
        : t("scope.count", { count: scopeKbs.length });

  const last = messages[messages.length - 1];
  const showThinking =
    busy &&
    (last?.role !== "assistant" ||
      !last.parts.some(
        (part) =>
          (part.type === "text" && part.text.trim()) ||
          (isToolPart(part) && part.state !== "output-available"),
      ) ||
      last.parts[last.parts.length - 1]?.type === "step-start");

  if (!activeProvider) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <EmptyState
          icon={BotIcon}
          title={t("chat.noLlm.title")}
          description={t("chat.noLlm.desc")}
          action={
            <Button nativeButton={false} render={<Link href="/settings" />}>
              {t("chat.noLlm.action")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <SourcesContext.Provider value={context}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
          {history}
          <KbScopePicker ontologies />
          <NativeSelect
            aria-label={t("chat.model")}
            className="min-w-0 flex-1 sm:w-52 sm:flex-none"
            value={activeProvider.id}
            onChange={(event) => {
              setProviderId(event.target.value);
              writeStorage(PROVIDER_KEY, event.target.value);
            }}
          >
            {configured.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {provider.model}
              </option>
            ))}
          </NativeSelect>
          <Popover>
            <PopoverTrigger
              render={<Button variant="outline" size="default" />}
            >
              <SlidersHorizontalIcon />
              {t(`search.mode.${prefs.mode}`)}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <p className="mb-3 text-sm font-medium">
                {t("chat.searchSettings")}
              </p>
              <SearchControls stacked />
            </PopoverContent>
          </Popover>
          <Button
            variant={deep ? "default" : "outline"}
            aria-pressed={deep}
            title={t("chat.deep.hint")}
            onClick={() => {
              setDeep(!deep);
              writeStorage(DEEP_KEY, !deep);
            }}
          >
            <BrainCircuitIcon />
            {t("chat.deep")}
          </Button>
        </div>

        <MessageScrollerProvider autoScroll>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport className="overflow-x-hidden">
              <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-5 p-4">
                {!messages.length ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
                    <div className="flex flex-col gap-1.5">
                      <h1 className="text-2xl font-semibold tracking-tight text-balance">
                        {t("chat.empty.title", { index: scopeLabel })}
                      </h1>
                      <p className="text-muted-foreground max-w-xl text-sm">
                        {t("chat.empty.desc")}
                      </p>
                    </div>
                    {sample ? (
                      <div className="flex max-w-xl flex-wrap justify-center gap-2">
                        {sample.questions.map((question) => (
                          <button
                            key={question}
                            type="button"
                            lang={guessLang(question)}
                            onClick={() => send(question)}
                            className="hover:bg-muted rounded-full border px-3 py-1.5 text-sm transition-colors"
                          >
                            {question}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                    >
                      <Message
                        align={message.role === "user" ? "end" : "start"}
                      >
                        <MessageContent>
                          {message.role === "user" ? (
                            <Bubble variant="default" align="end">
                              <BubbleContent>
                                {message.parts.map((part, at) =>
                                  part.type === "text" ? (
                                    <span
                                      key={at}
                                      lang={guessLang(part.text)}
                                      className="whitespace-pre-wrap"
                                    >
                                      {part.text}
                                    </span>
                                  ) : null,
                                )}
                              </BubbleContent>
                            </Bubble>
                          ) : (
                            <AssistantMessage
                              message={message}
                              streaming={busy && index === messages.length - 1}
                              last={index === messages.length - 1}
                              onRegenerate={() =>
                                void regenerate({ body: requestBody() })
                              }
                              verification={verifications[message.id]}
                              verifying={verifying === message.id}
                              onVerify={() => void verify(message.id)}
                            />
                          )}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))
                )}

                {showThinking ? (
                  <Marker role="status">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent className="shimmer">
                      {t("chat.thinking")}
                    </MarkerContent>
                  </Marker>
                ) : null}

                {error ? (
                  <Marker role="alert" className="text-destructive">
                    <MarkerIcon>
                      <CircleAlertIcon />
                    </MarkerIcon>
                    <MarkerContent>{errorText(error)}</MarkerContent>
                  </Marker>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          {queued ? (
            <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs">
              <CornerDownRightIcon className="size-3.5" />
              {t("chat.steer.queued")}
            </p>
          ) : null}
          <form
            onSubmit={onSubmit}
            className="bg-background focus-within:ring-ring/30 flex items-end gap-2 rounded-2xl border p-2 shadow-sm focus-within:ring-3"
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                busy ? t("chat.steer.placeholder") : t("chat.placeholder")
              }
              aria-label={t("chat.placeholder")}
              rows={1}
              className="max-h-48 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
              onKeyDown={(event) => {
                // Enter confirms an IME candidate while composing CJK text; don't send then.
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !isComposing(event)
                ) {
                  event.preventDefault();
                  send(input);
                }
              }}
            />
            {busy && input.trim() ? (
              <Button
                type="submit"
                size="icon"
                variant="secondary"
                className="size-9 shrink-0 rounded-full"
                title={t("chat.steer.label")}
              >
                <CornerDownRightIcon />
                <span className="sr-only">{t("chat.steer.label")}</span>
              </Button>
            ) : busy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="size-9 shrink-0 rounded-full"
                onClick={() => void stop()}
              >
                <SquareIcon className="fill-current" />
                <span className="sr-only">{t("chat.stop")}</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="size-9 shrink-0 rounded-full"
                disabled={!input.trim()}
              >
                <SendIcon />
                <span className="sr-only">{t("chat.send")}</span>
              </Button>
            )}
          </form>
        </div>
      </div>
      <DocViewer target={opened} onClose={() => setOpened(null)} />
      <OntologyViewer
        source={openedOntology}
        ontologies={ontologies}
        onClose={() => setOpenedOntology(null)}
      />
    </SourcesContext.Provider>
  );
}

/* ------------------------------------------------------------- history */

function ChatHistory({
  chats,
  currentId,
  onSelect,
  onNew,
  onDelete,
}: {
  chats: ChatSummary[];
  currentId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("chat.history")}
            />
          }
        >
          <HistoryIcon />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <p className="px-2 pt-1 pb-2 text-sm font-medium">
            {t("chat.history")}
          </p>
          {chats.length ? (
            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {chats.map((chat) => (
                <li key={chat.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(chat.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "hover:bg-muted flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left",
                      chat.id === currentId && "bg-muted",
                    )}
                  >
                    <span
                      className="truncate text-sm"
                      lang={guessLang(chat.title)}
                    >
                      {chat.title}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {new Date(chat.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`${t("chat.delete")} ${chat.title}`}
                    onClick={() => onDelete(chat.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-2 pb-2 text-sm">
              {t("chat.history.empty")}
            </p>
          )}
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("chat.new")}
        title={t("chat.new")}
        onClick={onNew}
      >
        <SquarePenIcon />
      </Button>
    </>
  );
}

export function ChatView() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<PublicSettings["llm"] | null>(
    null,
  );
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [session, setSession] = useState<{
    id: string;
    messages: ChatMessage[];
  } | null>(null);

  useEffect(() => {
    api<PublicSettings>("/api/settings")
      .then((settings) => setProviders(settings.llm))
      .catch(() => setProviders({ active: null, providers: [] }));
  }, []);

  // Restore the last conversation after mount (localStorage is client-only).
  useEffect(() => {
    const list = listChats();
    const current = readStorage<string | null>(CURRENT_KEY, null);
    const id =
      current && list.some((chat) => chat.id === current) ? current : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore
    setChats(list);
    setSession(
      id
        ? { id, messages: loadMessages(id) }
        : { id: newChatId(), messages: [] },
    );
  }, []);

  const select = (id: string) => {
    writeStorage(CURRENT_KEY, id);
    setSession({ id, messages: loadMessages(id) });
  };
  const startNew = () => {
    writeStorage(CURRENT_KEY, null);
    setSession({ id: newChatId(), messages: [] });
  };
  const remove = (id: string) => {
    setChats(deleteChat(id));
    if (session?.id === id) startNew();
  };
  const onSaved = useCallback((next: ChatSummary[]) => {
    setChats(next);
    setSession((current) => {
      if (current) writeStorage(CURRENT_KEY, current.id);
      return current;
    });
  }, []);

  return (
    <RequireIndexFrame>
      {providers && session ? (
        <ChatBody
          key={session.id}
          chatId={session.id}
          initialMessages={session.messages}
          providers={providers}
          onSaved={onSaved}
          history={
            <ChatHistory
              chats={chats}
              currentId={session.id}
              onSelect={select}
              onNew={startNew}
              onDelete={remove}
            />
          }
        />
      ) : (
        <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      )}
    </RequireIndexFrame>
  );
}

/**
 * Chat owns its own scrolling, so the empty states get a padded frame. With
 * an ontology connected, the chat works without any knowledge base.
 */
function RequireIndexFrame({ children }: { children: ReactNode }) {
  const { status, kbId, ontologies } = useWorkspace();
  if (ontologies?.length) return children;
  if ((status && !status.meilisearch.ok) || !kbId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <RequireIndex>{children}</RequireIndex>
      </div>
    );
  }
  return children;
}
