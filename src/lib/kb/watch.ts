import "server-only";

import { watch, type FSWatcher } from "node:fs";

import { singleton } from "@/lib/global";
import { startSync } from "@/lib/kb/jobs";
import { listKbConfigs } from "@/lib/kb/registry";
import type { KbConfig } from "@/lib/kb/types";

/** Re-sync directory knowledge bases shortly after their files change. */
const DEBOUNCE_MS = 5_000;

const watchers = singleton("kb-watchers", () => new Map<string, FSWatcher>());
const timers = singleton(
  "kb-watch-timers",
  () => new Map<string, NodeJS.Timeout>(),
);

export function unwatchKb(kbId: string) {
  watchers.get(kbId)?.close();
  watchers.delete(kbId);
  clearTimeout(timers.get(kbId));
  timers.delete(kbId);
}

export function watchKb(config: KbConfig) {
  unwatchKb(config.id);
  if (config.source.type !== "directory" || !config.source.watch) return;
  try {
    const watcher = watch(
      config.source.path,
      { recursive: true, persistent: false },
      (_event, filename) => {
        const name = filename?.toString() ?? "";
        if (
          name
            .split(/[\\/]/)
            .some((part) => part.startsWith(".") || part.startsWith("~$"))
        ) {
          return;
        }
        clearTimeout(timers.get(config.id));
        timers.set(
          config.id,
          setTimeout(() => startSync(config.id), DEBOUNCE_MS),
        );
      },
    );
    watcher.on("error", (error) => {
      console.error(`[kb] watcher for ${config.id} stopped`, error);
      unwatchKb(config.id);
    });
    watchers.set(config.id, watcher);
  } catch (error) {
    console.error(`[kb] cannot watch ${config.source.path}`, error);
  }
}

/** Called once at server start (instrumentation.ts). */
export async function startWatchers() {
  for (const config of await listKbConfigs()) {
    if (config.source.type === "directory" && config.source.watch) {
      watchKb(config);
      // Catch up on changes made while the server was down.
      startSync(config.id);
    }
  }
}
