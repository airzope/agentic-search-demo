"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { kbPath, useI18n } from "@/components/app-providers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { guessLang } from "@/lib/cjk";
import { api, errorMessage } from "@/lib/client";
import { cn } from "@/lib/utils";

type DocumentView = {
  kbName: string;
  title: string;
  path: string | null;
  chunkCount: number;
  chunks: { index: number; heading: string; content: string }[];
  truncated: boolean;
};

export type DocTarget = {
  kbId: string;
  docId: string;
  chunk: number | null;
  title?: string;
};

/** Full text of a knowledge-base document; the hit's chunk is highlighted. */
export function DocViewer({
  target,
  onClose,
}: {
  target: DocTarget | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before loading
    setDoc(null);
    setError(null);
    api<DocumentView>(
      `${kbPath(target.kbId)}/docs/${encodeURIComponent(target.docId)}`,
    )
      .then(setDoc)
      .catch((reason) => setError(errorMessage(reason)));
  }, [target]);

  useEffect(() => {
    focused.current?.scrollIntoView({ block: "center" });
  }, [doc]);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle lang={guessLang(doc?.title ?? target?.title ?? "")}>
          {doc?.title || target?.title || "…"}
        </DialogTitle>
        <DialogDescription className="flex flex-wrap gap-x-2 font-mono text-xs">
          <span>{doc?.kbName}</span>
          {doc?.path ? <span>/ {doc.path}</span> : null}
          {doc ? (
            <span>· {t("kb.doc.of", { count: doc.chunkCount })}</span>
          ) : null}
          {doc?.path && target ? (
            <a
              href={`${kbPath(target.kbId)}/files/raw?path=${encodeURIComponent(doc.path)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 font-sans underline-offset-3 hover:underline"
            >
              <ExternalLinkIcon className="size-3" />
              {t("doc.raw")}
            </a>
          ) : null}
        </DialogDescription>
        <div className="-mx-1 max-h-[65svh] overflow-y-auto px-1">
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {!doc && !error ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner /> {t("common.loading")}
            </div>
          ) : null}
          <div
            className="flex flex-col gap-3"
            lang={guessLang(doc?.chunks[0]?.content ?? "")}
          >
            {doc?.chunks.map((chunk) => {
              const active = target?.chunk === chunk.index;
              return (
                <div
                  key={chunk.index}
                  ref={active ? focused : undefined}
                  className={cn(
                    "rounded-lg border p-3",
                    active &&
                      "border-amber-400/70 bg-amber-50/60 dark:bg-amber-400/10",
                  )}
                >
                  <div className="text-muted-foreground mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{chunk.heading}</span>
                    <span className="shrink-0 tabular-nums">
                      {t("kb.doc.chunk", { n: chunk.index + 1 })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {chunk.content}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
