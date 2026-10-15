"use client";

import Link from "next/link";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { LOCALES } from "@/lib/cjk";
import type { SearchMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Mode, semantic ratio, embedder and query language — shared by search & chat. */
export function SearchControls({
  className,
  stacked = false,
}: {
  className?: string;
  stacked?: boolean;
}) {
  const { t } = useI18n();
  const { prefs, setPrefs, embedders, semanticAvailable } = useWorkspace();
  const hasEmbedder = semanticAvailable;

  return (
    <div
      className={cn(
        "flex gap-x-4 gap-y-3",
        stacked ? "flex-col" : "flex-wrap items-center",
        className,
      )}
    >
      <Segmented<SearchMode>
        aria-label={t("search.mode")}
        value={prefs.mode}
        onChange={(mode) => setPrefs({ mode })}
        options={[
          { value: "keyword", label: t("search.mode.keyword") },
          {
            value: "hybrid",
            label: t("search.mode.hybrid"),
            disabled: !hasEmbedder,
          },
          {
            value: "semantic",
            label: t("search.mode.semantic"),
            disabled: !hasEmbedder,
          },
        ]}
      />

      {prefs.mode === "hybrid" ? (
        <div className={cn("flex items-center gap-3", stacked ? "" : "w-56")}>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {t("search.ratio", { value: prefs.semanticRatio.toFixed(2) })}
          </span>
          <Slider
            aria-label={t("search.ratio", { value: "" })}
            min={0}
            max={1}
            step={0.05}
            value={prefs.semanticRatio}
            onValueChange={(value) =>
              setPrefs({
                semanticRatio: Array.isArray(value) ? value[0] : value,
              })
            }
          />
        </div>
      ) : null}

      {prefs.mode !== "keyword" && embedders.length > 1 ? (
        <NativeSelect
          aria-label={t("search.embedder")}
          className="w-40"
          value={prefs.embedder ?? ""}
          onChange={(event) => setPrefs({ embedder: event.target.value })}
        >
          {embedders.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect>
      ) : null}

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-xs">
          {t("search.locale")}
        </span>
        <NativeSelect
          className="w-28"
          value={prefs.locales[0] ?? ""}
          onChange={(event) =>
            setPrefs({
              locales: event.target.value ? [event.target.value] : [],
            })
          }
        >
          <option value="">{t("search.locale.auto")}</option>
          {LOCALES.map((locale) => (
            <option key={locale.code} value={locale.code}>
              {locale.label}
            </option>
          ))}
        </NativeSelect>
      </label>

      {!hasEmbedder ? (
        <p className="text-muted-foreground text-xs">
          {t("search.noEmbedder")}{" "}
          <Link
            href="/embedders"
            className="text-foreground underline underline-offset-3"
          >
            {t("search.configureEmbedder")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
