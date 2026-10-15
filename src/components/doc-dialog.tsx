"use client";

import { useI18n } from "@/components/app-providers";
import { Highlight } from "@/components/highlight";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { guessLang } from "@/lib/cjk";
import { fieldText } from "@/lib/display";
import type { SearchHit } from "@/lib/types";

/** Full document view: highlighted fields plus the raw JSON. */
export function DocDialog({
  hit,
  title,
  onOpenChange,
}: {
  hit: SearchHit | null;
  title: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const entries = hit
    ? Object.entries(hit).filter(([key]) => !key.startsWith("_"))
    : [];
  const raw = hit ? JSON.stringify(Object.fromEntries(entries), null, 2) : "";

  return (
    <Dialog open={hit !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle lang={guessLang(title)}>
          {title || t("search.document")}
        </DialogTitle>
        <Tabs defaultValue="fields" className="min-h-0">
          <TabsList>
            <TabsTrigger value="fields">{t("search.fields")}</TabsTrigger>
            <TabsTrigger value="raw">{t("search.raw")}</TabsTrigger>
          </TabsList>
          <TabsContent value="fields" className="max-h-[60svh] overflow-y-auto">
            <dl className="flex flex-col gap-3">
              {entries.map(([key, value]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground font-mono text-xs">
                    {key}
                  </dt>
                  <dd className="text-sm leading-relaxed whitespace-pre-wrap">
                    <Highlight value={fieldText(value)} />
                  </dd>
                </div>
              ))}
            </dl>
          </TabsContent>
          <TabsContent value="raw" className="max-h-[60svh] overflow-auto">
            <pre className="bg-muted rounded-lg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {raw}
            </pre>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
