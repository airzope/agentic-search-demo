"use client";

import { CircleAlertIcon, DatabaseIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Scrollable page body with a title row. */
export function Page({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6",
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon = DatabaseIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Renders children only when Meilisearch is reachable and an index exists;
 * otherwise shows the matching empty state.
 */
export function RequireIndex({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { status, kbs, kbId } = useWorkspace();

  if (status && !status.meilisearch.ok) {
    return (
      <EmptyState
        icon={CircleAlertIcon}
        title={t("empty.offline.title")}
        description={
          <>
            {t("empty.offline.desc")}
            <span className="mt-1 block font-mono text-xs">
              {status.meilisearch.host}
            </span>
          </>
        }
        action={
          <Button nativeButton={false} render={<Link href="/settings" />}>
            {t("empty.offline.action")}
          </Button>
        }
      />
    );
  }
  if (kbs === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }
  if (!kbId) {
    return (
      <EmptyState
        title={t("empty.noIndex.title")}
        description={t("empty.noIndex.desc")}
        action={
          <Button nativeButton={false} render={<Link href="/kb" />}>
            {t("empty.noIndex.action")}
          </Button>
        }
      />
    );
  }
  return children;
}

/** A titled section inside a page. */
export function Section({
  id,
  title,
  description,
  actions,
  className,
  children,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-4",
        "bg-card ring-foreground/10 flex min-w-0 flex-col gap-4 rounded-xl p-4 ring-1",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
