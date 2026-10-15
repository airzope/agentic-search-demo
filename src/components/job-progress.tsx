"use client";

import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";

import { useI18n } from "@/components/app-providers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { JobInfo } from "@/lib/kb/types";
import type { MessageKey } from "@/lib/i18n";

/** Progress and outcome of a knowledge-base sync job. */
export function JobProgress({
  job,
  onCancel,
  compact = false,
}: {
  job: JobInfo;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const running = job.status === "running" || job.status === "queued";
  const percent = job.total ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        {running ? (
          <Spinner className="size-4" />
        ) : job.status === "done" ? (
          <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <CircleAlertIcon className="text-destructive size-4" />
        )}
        <span className="font-medium">
          {t(`kb.phase.${job.phase}` as MessageKey)}
        </span>
        {running && job.total ? (
          <span className="text-muted-foreground tabular-nums">
            {job.processed}/{job.total}
          </span>
        ) : null}
        {running && onCancel ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={onCancel}
          >
            <XIcon />
            {t("kb.job.cancel")}
          </Button>
        ) : null}
      </div>
      {running ? (
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{
              width: `${job.phase === "scan" ? 5 : Math.max(percent, 3)}%`,
            }}
          />
        </div>
      ) : null}
      {running && job.current && !compact ? (
        <p className="text-muted-foreground truncate font-mono text-xs">
          {job.current}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {t("kb.job.stats", {
          added: job.added,
          updated: job.updated,
          deleted: job.deleted,
          skipped: job.skipped,
          failed: job.failed,
          chunks: job.chunks,
        })}
      </p>
      {job.status === "failed" && job.message ? (
        <p className="text-destructive text-xs wrap-break-word">
          {t("kb.job.failed", { message: job.message })}
        </p>
      ) : null}
      {!compact && job.errors.length ? (
        <details className="text-xs">
          <summary className="text-destructive cursor-pointer">
            {t("kb.errors")} ({job.errors.length})
          </summary>
          <ul className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto">
            {job.errors.map((error, at) => (
              <li key={at} className="wrap-break-word">
                <span className="font-mono">{error.path}</span>: {error.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!compact && job.warnings.length ? (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            {t("kb.warnings")} ({job.warnings.length})
          </summary>
          <ul className="text-muted-foreground mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto">
            {job.warnings.map((warning, at) => (
              <li key={at} className="wrap-break-word">
                {warning}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
