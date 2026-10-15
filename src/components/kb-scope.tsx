"use client";

import { CheckIcon, LibraryIcon } from "lucide-react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Pick the knowledge bases searched by the search and chat pages. */
export function KbScopePicker({ className }: { className?: string }) {
  const { t } = useI18n();
  const { kbs, connections, scope, setScope } = useWorkspace();
  const selected = (kbs ?? []).filter((kb) => scope.includes(kb.id));
  const label =
    selected.length === 1
      ? selected[0].name
      : t("scope.count", { count: selected.length });

  const toggle = (id: string) =>
    setScope(
      scope.includes(id) ? scope.filter((item) => item !== id) : [...scope, id],
    );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" className={cn("max-w-64", className)} />
        }
      >
        <LibraryIcon />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <span className="text-sm font-medium">{t("scope.label")}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => setScope((kbs ?? []).map((kb) => kb.id))}
          >
            {t("scope.all")}
          </button>
        </div>
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {connections.map((connection) => {
            const items = (kbs ?? []).filter(
              (kb) => kb.connectionId === connection.id,
            );
            if (!items.length) return null;
            return (
              <div key={connection.id} className="flex flex-col">
                {connections.length > 1 ? (
                  <span className="text-muted-foreground px-2 pb-1 text-xs">
                    {connection.name}
                  </span>
                ) : null}
                {items.map((kb) => {
                  const active = scope.includes(kb.id);
                  return (
                    <div key={kb.id} className="group flex items-center">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={active}
                        onClick={() => toggle(kb.id)}
                        className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            active &&
                              "bg-primary text-primary-foreground border-transparent",
                          )}
                        >
                          {active ? <CheckIcon className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {kb.name}
                        </span>
                        {kb.vector ? (
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            Qwen3
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground hidden shrink-0 px-1.5 text-xs group-hover:block"
                        onClick={() => setScope([kb.id])}
                      >
                        {t("scope.only")}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
