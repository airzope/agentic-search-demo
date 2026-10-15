"use client";

import { useChat } from "@ai-sdk/react";
import { MarkdownClient } from "@comark/react";
import breaks from "@comark/react/plugins/breaks";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BookOpenIcon,
  BotIcon,
  BrainCircuitIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FolderTreeIcon,
  SearchIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  SquarePenIcon,
} from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type FormEvent,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { DocViewer, type DocTarget } from "@/components/doc-viewer";
import { KbScopePicker } from "@/components/kb-scope";
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
import { guessLang, isComposing } from "@/lib/cjk";
import { api, readStorage, writeStorage } from "@/lib/client";
import type { PublicSettings } from "@/lib/providers";
import { getSampleByIndex } from "@/lib/samples";
import type { ChatMetadata } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChatMessage = UIMessage<ChatMetadata>;

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const isToolPart = (part: { type: string }): part is ToolPart =>
  part.type.startsWith("tool-");

const PROVIDER_KEY = "cjk-studio.provider";
const DEEP_KEY = "cjk-studio.deep";

/** A source the assistant saw: from search, browse or read results. */
type Source = {
  ref: string;
  kb?: string;
  title?: string;
  path?: string;
  heading?: string;
  snippet?: string;
};

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

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

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

/** Sources seen in this conversation (for citation popovers) and the document opener. */
const CitationContext = createContext<{
  sources: Map<string, Source>;
  open: (target: DocTarget) => void;
}>({ sources: new Map(), open: () => undefined });

function Citation({ id, children }: { id: string; children: ReactNode }) {
  const { t } = useI18n();
  const { sources, open } = useContext(CitationContext);
  // Citations may point at a chunk the model only saw via `read` (no chunk suffix).
  const source =
    sources.get(id) ?? sources.get(id.split("~").slice(0, 2).join("~"));
  const target = targetOf(id, source?.title);
  return (
    <Popover>
      <PopoverTrigger
        className="bg-primary/10 text-primary hover:bg-primary/20 mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-px items-center justify-center rounded-full px-1 align-middle text-[11px] font-semibold tabular-nums no-underline"
        aria-label={`${t("chat.source")} ${id}`}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        {source ? (
          <div
            className="flex flex-col gap-1.5"
            lang={guessLang(`${source.title ?? ""}${source.snippet ?? ""}`)}
          >
            <p className="text-muted-foreground truncate text-[11px]">
              {[source.kb, source.path].filter(Boolean).join(" · ")}
            </p>
            <p className="font-medium">{source.title || source.path || id}</p>
            {source.heading ? (
              <p className="text-muted-foreground text-xs">{source.heading}</p>
            ) : null}
            {source.snippet ? (
              <p className="text-muted-foreground line-clamp-6 text-xs leading-relaxed">
                {source.snippet}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs break-all">
            {id} · {t("chat.sourceMissing")}
          </p>
        )}
        {target ? (
          <Button
            size="xs"
            variant="outline"
            className="mt-2"
            onClick={() => open(target)}
          >
            <BookOpenIcon />
            {t("chat.openSource")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (typeof href === "string" && href.startsWith("#doc-")) {
    return (
      <Citation id={decodeURIComponent(href.slice(5))}>{children}</Citation>
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

/* --------------------------------------------------------------- tools */

type SearchOutput = {
  results?: {
    query: string;
    total?: number;
    hits: (Source & { duplicate?: boolean })[];
    warnings?: string[];
    errors?: { scope: string; message: string }[];
  }[];
};
type BrowseOutput = {
  branch?: string;
  folders?: { branch: string; files: number }[];
  files?: { ref: string; title: string; path: string }[];
};
type ReadOutput = {
  ref?: string;
  title?: string;
  path?: string;
  text?: string;
};

/** Every source in a tool result, keyed by ref. */
function sourcesOf(part: ToolPart): Source[] {
  if (part.state !== "output-available" || !part.output) return [];
  if (part.type === "tool-search") {
    return ((part.output as SearchOutput).results ?? []).flatMap((result) =>
      result.hits.filter((hit) => !hit.duplicate),
    );
  }
  if (part.type === "tool-browse") {
    return ((part.output as BrowseOutput).files ?? []).map((file) => ({
      ref: file.ref,
      title: file.title,
      path: file.path,
    }));
  }
  if (part.type === "tool-read") {
    const output = part.output as ReadOutput;
    return output.ref
      ? [
          {
            ref: output.ref,
            title: output.title,
            path: output.path,
            snippet: output.text?.slice(0, 400),
          },
        ]
      : [];
  }
  return [];
}

const joinQueries = (queries: unknown, lang: string) =>
  Array.isArray(queries)
    ? queries
        .map((query) => (lang === "zh" ? `「${query}」` : `“${query}”`))
        .join(" ")
    : "";

function ToolPartView({ part }: { part: ToolPart }) {
  const { t, lang } = useI18n();
  const { open } = useContext(CitationContext);
  const done = part.state === "output-available";

  if (part.state === "output-error") {
    return (
      <Marker role="alert" className="text-destructive">
        <MarkerIcon>
          <CircleAlertIcon />
        </MarkerIcon>
        <MarkerContent>{part.errorText}</MarkerContent>
      </Marker>
    );
  }

  if (part.type === "tool-browse") {
    const input = (part.input ?? {}) as { branch?: string };
    const output = (part.output ?? {}) as BrowseOutput;
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
    const input = (part.input ?? {}) as { ref?: string };
    const output = (part.output ?? {}) as ReadOutput;
    const target = input.ref ? targetOf(input.ref, output.title) : null;
    return (
      <Marker role="status">
        <MarkerIcon>
          <BookOpenIcon />
        </MarkerIcon>
        <MarkerContent className={done ? undefined : "shimmer"}>
          {done && target ? (
            <button
              type="button"
              className="hover:text-foreground text-left underline-offset-3 hover:underline"
              onClick={() => open(target)}
            >
              {t("chat.read", {
                title: output.title || output.path || input.ref || "",
              })}
            </button>
          ) : (
            t("chat.reading")
          )}
        </MarkerContent>
      </Marker>
    );
  }

  // search
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
  const results = (part.output as SearchOutput).results ?? [];
  const sources = sourcesOf(part);
  const notices = results.flatMap((result) => [
    ...(result.warnings ?? []),
    ...(result.errors ?? []).map((item) => `${item.scope}: ${item.message}`),
  ]);
  return (
    <Collapsible className="group w-full">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-sm">
        <SearchIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t("chat.searchedMulti", { queries, count: sources.length })}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="bg-muted/40 mt-2 flex flex-col gap-2 rounded-lg p-3 text-xs">
          {[...new Set(notices)].map((notice) => (
            <li key={notice} className="text-amber-700 dark:text-amber-400">
              {notice}
            </li>
          ))}
          {sources.map((source) => {
            const target = targetOf(source.ref, source.title);
            return (
              <li
                key={source.ref}
                className="flex flex-col gap-0.5"
                lang={guessLang(`${source.title ?? ""}${source.snippet ?? ""}`)}
              >
                <button
                  type="button"
                  className="text-left font-medium underline-offset-3 hover:underline"
                  onClick={() => target && open(target)}
                >
                  {source.title || source.path || source.ref}
                </button>
                <span className="text-muted-foreground truncate">
                  {[source.kb, source.path, source.heading]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {source.snippet ? (
                  <span className="text-muted-foreground line-clamp-2">
                    {source.snippet}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
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

function ChatBody({ providers }: { providers: PublicSettings["llm"] }) {
  const { t } = useI18n();
  const { kbs, scope, prefs } = useWorkspace();
  const configured = providers.providers.filter(
    (provider) => provider.configured,
  );
  const [providerId, setProviderId] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [input, setInput] = useState("");
  const [opened, setOpened] = useState<DocTarget | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage
    setProviderId(readStorage<string | null>(PROVIDER_KEY, null));
    setDeep(readStorage<boolean>(DEEP_KEY, false));
  }, []);

  const scopeKbs = (kbs ?? []).filter((kb) => scope.includes(kb.id));

  const activeProvider =
    configured.find((provider) => provider.id === providerId) ??
    configured.find((provider) => provider.id === providers.active) ??
    configured[0];

  const { messages, sendMessage, status, error, stop, setMessages } =
    useChat<ChatMessage>({ id: "chat", transport });

  const busy = status === "submitted" || status === "streaming";

  const citations = useMemo(() => {
    const sources = new Map<string, Source>();
    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolPart(part)) continue;
        for (const source of sourcesOf(part)) {
          sources.set(source.ref, { ...sources.get(source.ref), ...source });
        }
      }
    }
    return { sources, open: setOpened };
  }, [messages, setOpened]);

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

  const send = (text: string) => {
    const value = text.trim();
    if (!value || busy || !activeProvider) return;
    // Settings travel with each request, so switching model/scope applies immediately.
    void sendMessage(
      { text: value },
      {
        body: {
          kbs: scope,
          provider: activeProvider.id,
          model: activeProvider.model,
          search: prefs,
          deep,
        },
      },
    );
    setInput("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const sample = scopeKbs
    .filter((kb) => kb.connectionId === "local")
    .map((kb) => getSampleByIndex(kb.indexUid))
    .find(Boolean);
  const scopeLabel =
    scopeKbs.length === 1
      ? scopeKbs[0].name
      : t("scope.count", { count: scopeKbs.length });

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
    <CitationContext.Provider value={citations}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
          <KbScopePicker />
          <NativeSelect
            aria-label={t("chat.model")}
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
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
              {prefs.locales[0] ? ` · ${prefs.locales[0]}` : null}
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
          <Button
            variant="ghost"
            className="ml-auto"
            aria-label={t("chat.new")}
            disabled={!messages.length || busy}
            onClick={() => setMessages([])}
          >
            <SquarePenIcon />
            <span className="hidden sm:inline">{t("chat.new")}</span>
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
                      <p className="text-muted-foreground text-sm">
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
                  messages.map((message) => (
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
                                {message.parts.map((part, index) =>
                                  part.type === "text" ? (
                                    <span
                                      key={index}
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
                            <>
                              {message.parts.map((part, index) => {
                                if (part.type === "text") {
                                  if (!part.text.trim()) return null;
                                  return (
                                    <div
                                      key={index}
                                      lang={guessLang(part.text)}
                                      className="text-sm leading-relaxed wrap-break-word"
                                    >
                                      <MarkdownClient
                                        value={part.text}
                                        plugins={markdownPlugins}
                                        components={markdownComponents}
                                        streaming={part.state === "streaming"}
                                        className={markdownClassName}
                                      />
                                    </div>
                                  );
                                }
                                if (isToolPart(part)) {
                                  return (
                                    <ToolPartView
                                      key={part.toolCallId}
                                      part={part}
                                    />
                                  );
                                }
                                return null;
                              })}
                              {message.metadata?.model ? (
                                <p className="text-muted-foreground/70 text-[11px]">
                                  {message.metadata.provider} ·{" "}
                                  {message.metadata.model}
                                  {message.metadata.deep
                                    ? ` · ${t("chat.deep")}`
                                    : null}
                                </p>
                              ) : null}
                            </>
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
          <form
            onSubmit={onSubmit}
            className="bg-background focus-within:ring-ring/30 flex items-end gap-2 rounded-2xl border p-2 shadow-sm focus-within:ring-3"
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("chat.placeholder")}
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
            {busy ? (
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
    </CitationContext.Provider>
  );
}

export function ChatView() {
  const [providers, setProviders] = useState<PublicSettings["llm"] | null>(
    null,
  );
  const { t } = useI18n();

  useEffect(() => {
    api<PublicSettings>("/api/settings")
      .then((settings) => setProviders(settings.llm))
      .catch(() => setProviders({ active: null, providers: [] }));
  }, []);

  return (
    <RequireIndexFrame>
      {providers ? (
        <ChatBody providers={providers} />
      ) : (
        <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      )}
    </RequireIndexFrame>
  );
}

/** Chat owns its own scrolling, so the empty states get a padded frame. */
function RequireIndexFrame({ children }: { children: ReactNode }) {
  const { status, kbId } = useWorkspace();
  if ((status && !status.meilisearch.ok) || !kbId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <RequireIndex>{children}</RequireIndex>
      </div>
    );
  }
  return children;
}
