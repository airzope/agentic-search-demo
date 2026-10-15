"use client";

import {
  ChevronDownIcon,
  FunctionSquareIcon,
  SigmaIcon,
  WaypointsIcon,
  BoxesIcon,
} from "lucide-react";

import { useI18n } from "@/components/app-providers";
import { ActionProposalCard } from "@/components/chat/action-proposal";
import {
  SourceRow,
  useSources,
  type ToolPart,
} from "@/components/chat/sources";
import {
  AggregateTable,
  Provenance,
} from "@/components/ontology/object-viewer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import type {
  OntologyObjectsOutput,
  OntologySchemaOutput,
  Source,
} from "@/lib/agent/types";

export const isOntologyStep = (part: ToolPart) =>
  part.type.startsWith("tool-ontology_");

/** One ontology tool call in an answer. */
export function OntologyToolStep({ part }: { part: ToolPart }) {
  const { t } = useI18n();
  const { open } = useSources();
  const done = part.state === "output-available";
  const input = (part.input ?? {}) as {
    objectType?: string;
    function?: string;
  };

  if (part.type === "tool-ontology_propose_action") {
    return <ActionProposalCard part={part} />;
  }

  if (part.type === "tool-ontology_schema") {
    const output = (part.output ?? {}) as Partial<OntologySchemaOutput>;
    return (
      <Marker role="status">
        <MarkerIcon>
          <WaypointsIcon />
        </MarkerIcon>
        <MarkerContent className={done ? undefined : "shimmer"}>
          {!done
            ? t("onto.step.schemaRunning")
            : output.objectType
              ? t("onto.step.schemaType", {
                  type: output.objectType.displayName,
                })
              : t("onto.step.schemaList", {
                  count:
                    output.totalObjectTypes ?? output.objectTypes?.length ?? 0,
                })}
        </MarkerContent>
      </Marker>
    );
  }

  if (part.type === "tool-ontology_function") {
    const output = part.output as Source | undefined;
    return (
      <Marker role="status">
        <MarkerIcon>
          <FunctionSquareIcon />
        </MarkerIcon>
        <MarkerContent className={done ? undefined : "shimmer"}>
          {done && output ? (
            <button
              type="button"
              className="hover:text-foreground text-left underline-offset-3 hover:underline"
              onClick={() => open(output)}
            >
              {t("onto.step.ran", {
                name: output.title ?? input.function ?? "",
                value: (output.snippet ?? "").slice(0, 80),
              })}
              <span className="ml-1 tabular-nums">[{output.n}]</span>
            </button>
          ) : (
            t("onto.step.running")
          )}
        </MarkerContent>
      </Marker>
    );
  }

  if (part.type === "tool-ontology_aggregate") {
    const output = part.output as Source | undefined;
    if (!done || !output?.table) {
      return (
        <Marker role="status">
          <MarkerIcon>
            <SigmaIcon />
          </MarkerIcon>
          <MarkerContent className="shimmer">
            {t("onto.step.aggregating")}
          </MarkerContent>
        </Marker>
      );
    }
    return (
      <Collapsible className="group w-full">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-sm">
          <SigmaIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("onto.step.aggregated", { title: output.title ?? "" })}
            <span className="ml-1 tabular-nums">[{output.n}]</span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="bg-muted/40 mt-2 flex flex-col gap-3 rounded-lg p-3">
            <AggregateTable table={output.table} />
            <Provenance source={output} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // ontology_find / ontology_links
  if (!done) {
    return (
      <Marker role="status">
        <MarkerIcon>
          <BoxesIcon />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          {t("onto.step.finding", { type: input.objectType ?? "" })}
        </MarkerContent>
      </Marker>
    );
  }
  const output = (part.output ?? {}) as Partial<OntologyObjectsOutput>;
  const objects = output.objects ?? [];
  const details = [
    output.totalCount !== undefined
      ? t("onto.step.total", { total: output.totalCount })
      : null,
    output.hasMore ? t("onto.step.more") : null,
    output.via ? t("onto.step.linked", { link: output.via.link }) : null,
  ].filter(Boolean);
  return (
    <Collapsible className="group w-full">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-sm">
        <BoxesIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t("onto.step.found", {
            type: output.objectTypeName ?? output.objectType ?? "",
            count: objects.length,
          })}
          {details.length ? ` · ${details.join(" · ")}` : null}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="bg-muted/40 mt-2 flex flex-col gap-3 rounded-lg p-3 text-xs">
          {objects.length ? (
            <ol className="flex flex-col gap-2">
              {objects.map((object) => (
                <SourceRow key={object.ref} source={object} />
              ))}
            </ol>
          ) : null}
          {output.query ? (
            <Provenance
              source={{
                n: 0,
                ref: "",
                query: output.query,
                at: objects[0]?.at,
              }}
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
