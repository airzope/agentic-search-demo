"use client";

import type { Task } from "meilisearch";

/** JSON fetch that throws the API's `error` message on failure. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message =
      (body as { error?: string } | undefined)?.error ??
      (text.trim().slice(0, 300) ||
        `${response.status} ${response.statusText}`);
    throw new Error(message);
  }
  return body as T;
}

export const jsonBody = (value: unknown) => JSON.stringify(value);

const FINISHED = new Set(["succeeded", "failed", "canceled"]);

/** Poll a Meilisearch task until it finishes; throws if it failed. */
export async function waitForTask(
  taskUid: number,
  kbId?: string | null,
  timeoutMs = 10 * 60_000,
) {
  const query = kbId ? `?kb=${encodeURIComponent(kbId)}` : "";
  const started = Date.now();
  let delay = 150;
  while (Date.now() - started < timeoutMs) {
    const task = await api<Task>(`/api/tasks/${taskUid}${query}`);
    if (FINISHED.has(task.status)) {
      if (task.status !== "succeeded") {
        throw new Error(task.error?.message ?? `Task ${task.status}`);
      }
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 1500);
  }
  throw new Error("Timed out waiting for the task");
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** localStorage helpers that never throw (private mode, SSR…). */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
