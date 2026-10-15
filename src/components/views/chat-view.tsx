"use client";

import { useChat } from "@ai-sdk/react";
import { MarkdownClient } from "@comark/react";
import breaks from "@comark/react/plugins/breaks";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BotIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FileTextIcon,
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
import type { ChatHit, ChatMetadata } from "@/lib/types";
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

/** Hits seen in this conversation, for citation popovers. */
const CitationContext = createContext<Map<string, ChatHit>>(new Map());

function Citation({ id, children }: { id: string; children: ReactNode }) {
  const { t } = useI18n();
  const hits = useContext(CitationContext);
  const hit = hits.get(id);
  return (
    <Popover>
      <PopoverTrigger
        className="bg-primary/10 text-primary hover:bg-primary/20 mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-px items-center justify-center rounded-full px-1 align-middle text-[11px] font-semibold tabular-nums no-underline"
        aria-label={`${t("chat.source")} ${id}`}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        {hit ? (
          <div
            className="flex flex-col gap-1.5"
            lang={guessLang(hit.title + hit.snippet)}
          >
            <p className="text-muted-foreground font-mono text-[11px]">
              #{hit.id}
            </p>
            <p className="font-medium">{hit.title || `#${hit.id}`}</p>
            <p className="text-muted-foreground line-clamp-6 text-xs leading-relaxed">
              {hit.snippet}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            #{id} · {t("chat.sourceMissing")}
          </p>
        )}
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

function hitsOf(output: unknown): ChatHit[] {
  const hits = (output as { hits?: unknown } | null)?.hits;
  return Array.isArray(hits) ? (hits as ChatHit[]) : [];
}

function ToolPartView({ part }: { part: ToolPart }) {
  const { t } = useI18n();
  const input = (part.input ?? {}) as { query?: string; id?: string };

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

  if (part.type === "tool-get_document") {
    const done = part.state === "output-available";
    return (
      <Marker role="status">
        <MarkerIcon>
          <FileTextIcon />
        </MarkerIcon>
        <MarkerContent className={done ? undefined : "shimmer"}>
          {t(done ? "chat.fetched" : "chat.fetching", { id: input.id ?? "" })}
        </MarkerContent>
      </Marker>
    );
  }

  if (part.state !== "output-available") {
    return (
      <Marker role="status">
        <MarkerIcon>
          <SearchIcon />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          {t("chat.searching", { query: input.query ?? "" })}
        </MarkerContent>
      </Marker>
    );
  }

  const hits = hitsOf(part.output);
  return (
    <Collapsible className="group w-full">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-sm">
        <SearchIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t("chat.searched", { query: input.query ?? "", count: hits.length })}
        </span>
        {hits.length ? (
          <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-open:rotate-180" />
        ) : null}
      </CollapsibleTrigger>
      {hits.length ? (
        <CollapsibleContent>
          <ol className="bg-muted/40 mt-2 flex flex-col gap-2 rounded-lg p-3 text-xs">
            {hits.map((hit) => (
              <li
                key={hit.id}
                className="flex flex-col gap-0.5"
                lang={guessLang(hit.title + hit.snippet)}
              >
                <span className="font-medium">
                  <span className="text-muted-foreground mr-1.5 font-mono">
                    #{hit.id}
                  </span>
                  {hit.title}
                </span>
                <span className="text-muted-foreground line-clamp-2">
                  {hit.snippet}
                </span>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      ) : null}
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
  const { indexUid, prefs } = useWorkspace();
  const configured = providers.providers.filter(
    (provider) => provider.configured,
  );
  const [providerId, setProviderId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    const saved = readStorage<string | null>(PROVIDER_KEY, null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage
    setProviderId(saved);
  }, []);

  const activeProvider =
    configured.find((provider) => provider.id === providerId) ??
    configured.find((provider) => provider.id === providers.active) ??
    configured[0];

  const { messages, sendMessage, status, error, stop, setMessages } =
    useChat<ChatMessage>({ id: `chat-${indexUid}`, transport });

  const busy = status === "submitted" || status === "streaming";

  const citations = useMemo(() => {
    const map = new Map<string, ChatHit>();
    for (const message of messages) {
      for (const part of message.parts) {
        if (isToolPart(part) && part.state === "output-available") {
          for (const hit of hitsOf(part.output)) map.set(String(hit.id), hit);
        }
      }
    }
    return map;
  }, [messages]);

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
    // Settings travel with each request, so switching model/index applies immediately.
    void sendMessage(
      { text: value },
      {
        body: {
          indexUid,
          provider: activeProvider.id,
          model: activeProvider.model,
          search: prefs,
        },
      },
    );
    setInput("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const sample = indexUid ? getSampleByIndex(indexUid) : undefined;

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
                        {t("chat.empty.title", { index: indexUid ?? "" })}
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
  const { status, indexUid } = useWorkspace();
  if ((status && !status.meilisearch.ok) || !indexUid) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <RequireIndex>{children}</RequireIndex>
      </div>
    );
  }
  return children;
}
