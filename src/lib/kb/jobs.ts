import "server-only";

import { randomUUID } from "node:crypto";

import { singleton } from "@/lib/global";
import { getKbConfig } from "@/lib/kb/registry";
import { runSync } from "@/lib/kb/sync";
import type { JobInfo } from "@/lib/kb/types";

/** In-process sync jobs: one running job per knowledge base. */
type JobState = {
  jobs: Map<string, JobInfo>;
  controllers: Map<string, AbortController>;
  /** Knowledge bases that changed while a sync was running. */
  rerun: Set<string>;
};

const state = singleton<JobState>("kb-jobs", () => ({
  jobs: new Map(),
  controllers: new Map(),
  rerun: new Set(),
}));

const MAX_KEPT = 100;

function newJob(kbId: string, force: boolean, rebuild: boolean): JobInfo {
  return {
    id: randomUUID(),
    kbId,
    status: "queued",
    phase: "queued",
    force,
    rebuild,
    startedAt: null,
    finishedAt: null,
    total: 0,
    processed: 0,
    skipped: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    failed: 0,
    chunks: 0,
    current: null,
    errors: [],
    warnings: [],
    message: null,
  };
}

export function activeJob(kbId: string) {
  return (
    [...state.jobs.values()].find(
      (job) =>
        job.kbId === kbId &&
        (job.status === "running" || job.status === "queued"),
    ) ?? null
  );
}

export function latestJob(kbId: string) {
  return (
    [...state.jobs.values()].filter((job) => job.kbId === kbId).at(-1) ?? null
  );
}

export function listJobs(kbId?: string) {
  return [...state.jobs.values()]
    .filter((job) => !kbId || job.kbId === kbId)
    .reverse();
}

export const getJob = (id: string) => state.jobs.get(id) ?? null;

export function cancelJob(id: string) {
  state.controllers.get(id)?.abort();
  return getJob(id);
}

/**
 * Start (or join) a sync for a knowledge base. `force` retries failed files,
 * `rebuild` clears the index and processes every file again.
 */
export function startSync(
  kbId: string,
  { force = false, rebuild = false } = {},
): JobInfo {
  const running = activeJob(kbId);
  if (running) {
    state.rerun.add(kbId);
    return running;
  }
  const job = newJob(kbId, force || rebuild, rebuild);
  const controller = new AbortController();
  state.jobs.set(job.id, job);
  state.controllers.set(job.id, controller);
  while (state.jobs.size > MAX_KEPT) {
    state.jobs.delete(state.jobs.keys().next().value as string);
  }

  void (async () => {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    try {
      const config = await getKbConfig(kbId);
      if (!config)
        throw new Error("This knowledge base has no file source to sync");
      await runSync(config, job, controller.signal);
      job.status = controller.signal.aborted ? "canceled" : "done";
    } catch (error) {
      job.status = controller.signal.aborted ? "canceled" : "failed";
      job.message = error instanceof Error ? error.message : String(error);
      console.error(`[kb] sync ${kbId} failed`, error);
    } finally {
      job.phase = "done";
      job.current = null;
      job.finishedAt = new Date().toISOString();
      state.controllers.delete(job.id);
      if (state.rerun.delete(kbId) && job.status === "done") startSync(kbId);
    }
  })();

  return job;
}
