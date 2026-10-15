"use client";

import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ShieldAlertIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/components/app-providers";
import { TextWithCitations, type ToolPart } from "@/components/chat/sources";
import { formatValue, ontologyPath } from "@/components/ontology/object-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import type { ActionProposalOutput } from "@/lib/agent/types";
import { guessLang } from "@/lib/cjk";
import {
  api,
  errorMessage,
  jsonBody,
  readStorage,
  writeStorage,
} from "@/lib/client";
import type { ActionAuditEntry } from "@/lib/ontology/types";

/** What the user decided about a proposal; kept in the browser. */
type Decision = {
  status: "applied" | "rejected" | "failed";
  at: string;
  message?: string;
  edits?: ActionAuditEntry["edits"] | null;
};

const decisionKey = (toolCallId: string) => `cjk-studio.action:${toolCallId}`;

/**
 * An action proposed by the assistant. Nothing is written to Foundry until
 * the user approves; the server validates again and logs the result.
 */
export function ActionProposalCard({ part }: { part: ToolPart }) {
  const { t } = useI18n();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage
    setDecision(
      readStorage<Decision | null>(decisionKey(part.toolCallId), null),
    );
  }, [part.toolCallId]);

  if (part.state !== "output-available" || !part.output) {
    return (
      <Marker role="status">
        <MarkerIcon>
          <ZapIcon />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          {t("onto.step.proposing")}
        </MarkerContent>
      </Marker>
    );
  }
  const proposal = part.output as ActionProposalOutput;
  const valid = proposal.validation.result === "VALID";
  const labels = new Map(
    proposal.parameterInfo.map((item) => [
      item.name,
      item.displayName || item.name,
    ]),
  );

  const decide = (next: Decision) => {
    setDecision(next);
    writeStorage(decisionKey(part.toolCallId), next);
  };

  const approve = async () => {
    setApplying(true);
    try {
      const result = await api<{ ok: boolean; edits?: Decision["edits"] }>(
        `${ontologyPath(proposal.ontology)}/actions`,
        {
          method: "POST",
          body: jsonBody({
            action: proposal.action,
            parameters: proposal.parameters,
            mode: "apply",
          }),
        },
      );
      decide({
        status: "applied",
        at: new Date().toISOString(),
        edits: result.edits ?? null,
      });
    } catch (error) {
      decide({
        status: "failed",
        at: new Date().toISOString(),
        message: errorMessage(error),
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-amber-400/60 bg-amber-50/50 p-3 dark:bg-amber-400/5">
      <div className="flex flex-wrap items-center gap-2">
        <ZapIcon className="size-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium">{t("action.title")}</span>
        <span className="text-muted-foreground text-xs">
          {proposal.ontologyName}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span
          className="text-sm font-medium"
          lang={guessLang(proposal.actionName ?? "")}
        >
          {proposal.actionName || proposal.action}{" "}
          <span className="text-muted-foreground font-mono text-xs font-normal">
            {proposal.action}
          </span>
        </span>
        {proposal.description ? (
          <span className="text-muted-foreground text-xs">
            {proposal.description}
          </span>
        ) : null}
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <tbody>
          {Object.entries(proposal.parameters).map(([name, value]) => (
            <tr
              key={name}
              className="border-t border-amber-400/30 first:border-t-0"
            >
              <th className="text-muted-foreground w-1/3 py-1 pr-2 align-top text-xs font-normal">
                {labels.get(name) ?? name}
                <span className="block font-mono text-[10px]">{name}</span>
              </th>
              <td
                className="py-1 align-top break-all"
                lang={guessLang(String(value))}
              >
                {formatValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {proposal.reason ? (
        <p className="text-sm" lang={guessLang(proposal.reason)}>
          <span className="text-muted-foreground">{t("action.reason")}：</span>
          <TextWithCitations text={proposal.reason} />
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={valid ? "success" : "destructive"}>
          {valid ? <CheckCircle2Icon /> : <CircleAlertIcon />}
          {valid ? t("action.valid") : t("action.invalid")}
        </Badge>
        {proposal.validation.messages.map((message) => (
          <span key={message} className="text-destructive text-xs">
            {message}
          </span>
        ))}
      </div>
      {decision && decision.status !== "failed" ? (
        <p
          role="status"
          className={
            decision.status === "applied"
              ? "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground flex items-center gap-1.5 text-sm"
          }
        >
          {decision.status === "applied" ? (
            <CheckCircle2Icon className="size-4" />
          ) : (
            <XCircleIcon className="size-4" />
          )}
          {decision.status === "applied"
            ? `${t("action.applied", { time: new Date(decision.at).toLocaleString() })}${
                decision.edits
                  ? ` · ${t("action.appliedEdits", {
                      modified: decision.edits.modified,
                      added: decision.edits.added,
                      deleted: decision.edits.deleted,
                    })}`
                  : ""
              }`
            : t("action.rejected")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {decision?.status === "failed" ? (
            <p
              role="alert"
              className="text-destructive flex items-start gap-1.5 text-sm"
            >
              <XCircleIcon className="mt-0.5 size-4 shrink-0" />
              {t("action.failed", { error: decision.message ?? "" })}
            </p>
          ) : null}
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <ShieldAlertIcon className="mt-px size-3.5 shrink-0" />
            {t("action.notice")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!valid || applying}
              onClick={() => void approve()}
            >
              {applying ? <Spinner /> : <ZapIcon />}
              {applying ? t("action.applying") : t("action.approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={applying}
              onClick={() =>
                decide({ status: "rejected", at: new Date().toISOString() })
              }
            >
              {t("action.reject")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
