"use client";

import {
  CircleAlertIcon,
  FunctionSquareIcon,
  KeyRoundIcon,
  PlusIcon,
  ShieldCheckIcon,
  WaypointsIcon,
  ZapIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { ontologyPath } from "@/components/ontology/object-viewer";
import { OntologyFormDialog } from "@/components/ontology/ontology-form";
import { EmptyState, Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/client";
import type { OntologyStatus, PublicOntology } from "@/lib/ontology/types";

export const ontologyHref = (id: string) =>
  `/ontology/${encodeURIComponent(id)}`;

/** Badges for what a connection allows. */
export function OntologyBadges({ connection }: { connection: PublicOntology }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">
        <KeyRoundIcon />
        {connection.auth === "oauth"
          ? t("onto.auth.oauth")
          : t("onto.auth.token")}
      </Badge>
      {connection.allowActions ? (
        <Badge variant="warning">
          <ZapIcon />
          {t("onto.actionsAllowed")}
        </Badge>
      ) : (
        <Badge variant="outline">
          <ShieldCheckIcon />
          {t("onto.readOnly")}
        </Badge>
      )}
      {connection.allowFunctions ? (
        <Badge variant="outline">
          <FunctionSquareIcon />
          {t("onto.functionsAllowed")}
        </Badge>
      ) : null}
      {connection.objectTypes.length ? (
        <Badge variant="outline">
          {t("onto.restricted", { count: connection.objectTypes.length })}
        </Badge>
      ) : null}
      {connection.source === "env" ? (
        <Badge variant="secondary">{t("onto.env")}</Badge>
      ) : null}
    </div>
  );
}

/** Live status line of a connection. */
export function OntologyStatusLine({
  status,
}: {
  status: OntologyStatus | null;
}) {
  const { t } = useI18n();
  if (!status) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Spinner /> {t("common.loading")}
      </span>
    );
  }
  if (!status.ok) {
    return (
      <span className="text-destructive flex items-start gap-1.5 text-xs break-all">
        <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
        {t("onto.status.error")}: {status.error}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
      <span className="size-2 rounded-full bg-emerald-500" />
      <span className="text-foreground">{status.ontology.displayName}</span>
      <span>
        ·{" "}
        {t("onto.counts", {
          objects: status.objectTypes,
          actions: status.actionTypes,
          functions: status.functions,
        })}
      </span>
    </span>
  );
}

function OntologyCard({ connection }: { connection: PublicOntology }) {
  const [status, setStatus] = useState<OntologyStatus | null>(null);
  useEffect(() => {
    api<{ status: OntologyStatus }>(ontologyPath(connection.id))
      .then((result) => setStatus(result.status))
      .catch((error) =>
        setStatus({ ok: false, error: String(error?.message ?? error) }),
      );
  }, [connection.id]);
  let host = connection.baseUrl;
  try {
    host = new URL(connection.baseUrl).host;
  } catch {
    // keep the raw URL
  }
  return (
    <li className="bg-card ring-foreground/10 flex min-w-0 flex-col gap-3 rounded-xl p-4 ring-1">
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          href={ontologyHref(connection.id)}
          className="truncate font-medium underline-offset-3 hover:underline"
        >
          {connection.name}
        </Link>
        <span className="text-muted-foreground truncate font-mono text-xs">
          {host} · {connection.ontology}
        </span>
      </div>
      {connection.description ? (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {connection.description}
        </p>
      ) : null}
      <OntologyStatusLine status={status} />
      <OntologyBadges connection={connection} />
    </li>
  );
}

export function OntologyListView() {
  const { t } = useI18n();
  const { ontologies, refreshOntologies } = useWorkspace();
  const [creating, setCreating] = useState(false);

  return (
    <Page
      title={t("onto.title")}
      description={t("onto.desc")}
      actions={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon />
          {t("onto.add")}
        </Button>
      }
    >
      {ontologies === null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
          <Spinner /> {t("common.loading")}
        </div>
      ) : ontologies.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ontologies.map((connection) => (
            <OntologyCard key={connection.id} connection={connection} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={WaypointsIcon}
          title={t("onto.empty.title")}
          description={t("onto.empty.desc")}
          action={
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              {t("onto.add")}
            </Button>
          }
        />
      )}
      {creating ? (
        <OntologyFormDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={() => void refreshOntologies()}
        />
      ) : null}
    </Page>
  );
}
