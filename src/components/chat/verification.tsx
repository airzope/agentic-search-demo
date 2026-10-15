"use client";

import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  CircleXIcon,
  QuoteIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/components/app-providers";
import { CitationChip } from "@/components/chat/sources";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { stripCitations } from "@/lib/agent/claims";
import type { ClaimStatus, Verification } from "@/lib/agent/types";
import { guessLang } from "@/lib/cjk";
import { cn } from "@/lib/utils";

const STATUS: Record<
  ClaimStatus,
  { icon: LucideIcon; className: string; bar: string }
> = {
  supported: {
    icon: CircleCheckIcon,
    className: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  unjudged: {
    icon: CircleDashedIcon,
    className: "text-sky-600 dark:text-sky-400",
    bar: "bg-sky-500",
  },
  partial: {
    icon: CircleHelpIcon,
    className: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  uncited: {
    icon: QuoteIcon,
    className: "text-orange-600 dark:text-orange-400",
    bar: "bg-orange-400",
  },
  unsupported: {
    icon: CircleXIcon,
    className: "text-destructive",
    bar: "bg-destructive",
  },
  neutral: {
    icon: CircleMinusIcon,
    className: "text-muted-foreground",
    bar: "bg-muted-foreground/30",
  },
};

const ORDER: ClaimStatus[] = [
  "supported",
  "unjudged",
  "partial",
  "uncited",
  "unsupported",
  "neutral",
];

/** Claim-by-claim check of an answer against its cited sources. */
export function VerificationPanel({
  verification,
  running,
  onRerun,
}: {
  verification: Verification;
  running: boolean;
  onRerun: () => void;
}) {
  const { t } = useI18n();
  const { summary, claims } = verification;
  const factual = claims.length - summary.neutral;
  const supported = summary.supported + summary.unjudged;

  return (
    <Collapsible defaultOpen className="group/verify rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
          <ShieldCheckIcon className="size-4 shrink-0" />
          <span className="font-medium">{t("verify.title")}</span>
          <span className="text-muted-foreground truncate text-xs">
            {t("verify.summary", { supported, total: factual })}
          </span>
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0 transition-transform group-data-open/verify:rotate-180" />
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("verify.rerun")}
          title={t("verify.rerun")}
          disabled={running}
          onClick={onRerun}
        >
          {running ? <Spinner /> : <RotateCcwIcon />}
        </Button>
      </div>
      {factual > 0 ? (
        <div
          className="bg-muted mt-2 flex h-1.5 overflow-hidden rounded-full"
          aria-hidden
        >
          {ORDER.filter((status) => status !== "neutral").map((status) =>
            summary[status] ? (
              <span
                key={status}
                className={STATUS[status].bar}
                style={{ width: `${(summary[status] / factual) * 100}%` }}
              />
            ) : null,
          )}
        </div>
      ) : null}
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {ORDER.filter((status) => summary[status]).map((status) => {
          const Icon = STATUS[status].icon;
          return (
            <span key={status} className="flex items-center gap-1">
              <Icon className={cn("size-3", STATUS[status].className)} />
              {t(`verify.status.${status}`)} {summary[status]}
            </span>
          );
        })}
      </div>
      <CollapsibleContent>
        <ol className="mt-3 flex flex-col gap-2.5">
          {claims.map((claim) => {
            const style = STATUS[claim.status];
            const Icon = style.icon;
            const missingNumbers = claim.numbers.filter((n) => !n.found);
            return (
              <li key={claim.id} className="flex gap-2 text-sm">
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", style.className)}
                  aria-label={t(`verify.status.${claim.status}`)}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p lang={guessLang(claim.text)} className="leading-relaxed">
                    {stripCitations(claim.text)}
                    {claim.cited.map((n) => (
                      <CitationChip key={n} n={n} />
                    ))}
                  </p>
                  <p className={cn("text-xs", style.className)}>
                    {t(`verify.status.${claim.status}`)}
                    {claim.reason ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {claim.reason}
                      </span>
                    ) : null}
                  </p>
                  {missingNumbers.map((number) => (
                    <p
                      key={number.text}
                      className="text-xs text-amber-700 dark:text-amber-400"
                    >
                      {t("verify.numberMissing", { value: number.text })}
                    </p>
                  ))}
                  {claim.missing.length ? (
                    <p className="text-destructive text-xs">
                      {t("verify.missingSource", {
                        list: claim.missing.map((n) => `[${n}]`).join(""),
                      })}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-muted-foreground mt-3 text-[11px]">
          {verification.error
            ? t("verify.error", { error: verification.error })
            : verification.judged
              ? t("verify.judgedBy", {
                  model: verification.model ?? "",
                  time: new Date(verification.at).toLocaleString(),
                })
              : t("verify.ruleOnly")}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
