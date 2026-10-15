/**
 * Conversations kept in the browser (localStorage): an index of chats plus
 * the messages of each one. Large tool outputs are trimmed before saving.
 */
import type { ChatMessage, Verification } from "@/lib/agent/types";
import { readStorage, writeStorage } from "@/lib/client";

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: number;
  /** Knowledge bases the chat used last. */
  kbs?: string[];
};

const INDEX_KEY = "cjk-studio.chats";
const messagesKey = (id: string) => `cjk-studio.chat:${id}`;
const verifyKey = (id: string) => `cjk-studio.verify:${id}`;
const MAX_CHATS = 60;
const MAX_TEXT = 1500;

export const newChatId = () =>
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function listChats(): ChatSummary[] {
  const chats = readStorage<ChatSummary[]>(INDEX_KEY, []);
  return Array.isArray(chats)
    ? [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
    : [];
}

export function loadMessages(id: string): ChatMessage[] {
  const messages = readStorage<ChatMessage[]>(messagesKey(id), []);
  return Array.isArray(messages) ? messages : [];
}

function trim(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type === "reasoning" && part.text.length > MAX_TEXT * 2) {
        return { ...part, text: `${part.text.slice(0, MAX_TEXT * 2)}…` };
      }
      if (
        part.type === "tool-read" &&
        part.state === "output-available" &&
        part.output &&
        typeof (part.output as { text?: unknown }).text === "string"
      ) {
        const output = part.output as { text: string };
        if (output.text.length > MAX_TEXT) {
          return {
            ...part,
            output: { ...output, text: `${output.text.slice(0, MAX_TEXT)}…` },
          };
        }
      }
      return part;
    }) as ChatMessage["parts"],
  }));
}

const titleOf = (messages: ChatMessage[]) => {
  const first = messages.find((message) => message.role === "user");
  const text =
    first?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim() ?? "";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
};

/** Save a conversation and move it to the top of the list. */
export function saveChat(id: string, messages: ChatMessage[], kbs?: string[]) {
  if (!messages.length) return listChats();
  const chats = listChats().filter((chat) => chat.id !== id);
  const summary: ChatSummary = {
    id,
    title: titleOf(messages) || "…",
    updatedAt: Date.now(),
    kbs,
  };
  const next = [summary, ...chats];
  for (const dropped of next.slice(MAX_CHATS)) removeMessages(dropped.id);
  writeStorage(INDEX_KEY, next.slice(0, MAX_CHATS));
  writeStorage(messagesKey(id), trim(messages));
  return next.slice(0, MAX_CHATS);
}

function removeMessages(id: string) {
  try {
    localStorage.removeItem(messagesKey(id));
    localStorage.removeItem(verifyKey(id));
  } catch {
    // storage unavailable
  }
}

/** Answer verifications of a chat, by message id. */
export function loadVerifications(id: string): Record<string, Verification> {
  const value = readStorage<Record<string, Verification>>(verifyKey(id), {});
  return value && typeof value === "object" ? value : {};
}

export function saveVerification(id: string, verification: Verification) {
  const all = {
    ...loadVerifications(id),
    [verification.messageId]: verification,
  };
  writeStorage(verifyKey(id), all);
  return all;
}

export function deleteChat(id: string) {
  removeMessages(id);
  const next = listChats().filter((chat) => chat.id !== id);
  writeStorage(INDEX_KEY, next);
  return next;
}
