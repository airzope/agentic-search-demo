"use client";

import { CheckIcon, LibraryIcon, WaypointsIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function ScopeItem({
  active,
  label,
  extra,
  onToggle,
  onOnly,
  onlyLabel,
}: {
  active: boolean;
  label: ReactNode;
  extra?: ReactNode;
  onToggle: () => void;
  onOnly: () => void;
  onlyLabel: string;
}) {
  return (
    <div className="group flex items-center">
      <button
        type="button"
        role="checkbox"
        aria-checked={active}
        onClick={onToggle}
        className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded border",
            active && "bg-primary text-primary-foreground border-transparent",
          )}
        >
          {active ? <CheckIcon className="size-3" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {extra}
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground hidden shrink-0 px-1.5 text-xs group-hover:block"
        onClick={onOnly}
      >
        {onlyLabel}
      </button>
    </div>
  );
}

/**
 * Pick the knowledge bases searched by the search and chat pages; with
 * `ontologies`, also the Foundry ontologies the chat may query.
 */
export function KbScopePicker({
  className,
  ontologies: withOntologies = false,
}: {
  className?: string;
  ontologies?: boolean;
}) {
  const { t } = useI18n();
  const {
    kbs,
    connections,
    scope,
    setScope,
    ontologies,
    ontologyScope,
    setOntologyScope,
  } = useWorkspace();
  const showOntologies = withOntologies && Boolean(ontologies?.length);
  const selected = (kbs ?? []).filter((kb) => scope.includes(kb.id));
  const selectedOntologies = showOntologies
    ? (ontologies ?? []).filter((item) => ontologyScope.includes(item.id))
    : [];
  const total = selected.length + selectedOntologies.length;
  const label =
    total === 1
      ? (selected[0]?.name ?? selectedOntologies[0]?.name)
      : showOntologies && selectedOntologies.length
        ? t("scope.countMixed", { count: total })
        : t("scope.count", { count: selected.length });

  const toggle = (id: string) =>
    setScope(
      scope.includes(id) ? scope.filter((item) => item !== id) : [...scope, id],
    );
  const toggleOntology = (id: string) =>
    setOntologyScope(
      ontologyScope.includes(id)
        ? ontologyScope.filter((item) => item !== id)
        : [...ontologyScope, id],
    );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" className={cn("max-w-64", className)} />
        }
      >
        {selectedOntologies.length && !selected.length ? (
          <WaypointsIcon />
        ) : (
          <LibraryIcon />
        )}
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <span className="text-sm font-medium">{t("scope.label")}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => {
              setScope((kbs ?? []).map((kb) => kb.id));
              if (showOntologies) {
                setOntologyScope((ontologies ?? []).map((item) => item.id));
              }
            }}
          >
            {t("scope.all")}
          </button>
        </div>
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {showOntologies && kbs?.length ? (
            <span className="text-muted-foreground px-2 text-xs font-medium">
              {t("scope.knowledgeBases")}
            </span>
          ) : null}
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
                {items.map((kb) => (
                  <ScopeItem
                    key={kb.id}
                    active={scope.includes(kb.id)}
                    label={kb.name}
                    extra={
                      kb.vector ? (
                        <span className="text-muted-foreground shrink-0 text-[10px]">
                          Qwen3
                        </span>
                      ) : null
                    }
                    onToggle={() => toggle(kb.id)}
                    onOnly={() => {
                      setScope([kb.id]);
                      if (showOntologies) setOntologyScope([]);
                    }}
                    onlyLabel={t("scope.only")}
                  />
                ))}
              </div>
            );
          })}
          {showOntologies ? (
            <div className="flex flex-col">
              <span className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                {t("scope.ontologies")}
              </span>
              {(ontologies ?? []).map((item) => (
                <ScopeItem
                  key={item.id}
                  active={ontologyScope.includes(item.id)}
                  label={item.name}
                  extra={
                    <WaypointsIcon className="text-muted-foreground size-3.5 shrink-0" />
                  }
                  onToggle={() => toggleOntology(item.id)}
                  onOnly={() => {
                    setOntologyScope([item.id]);
                    setScope([]);
                  }}
                  onlyLabel={t("scope.only")}
                />
              ))}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
