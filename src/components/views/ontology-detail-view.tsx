"use client";

import {
  ArrowLeftIcon,
  BoxIcon,
  KeyRoundIcon,
  LinkIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { CheckField } from "@/components/kb-form";
import {
  OntologyViewer,
  formatValue,
  ontologyPath,
  type ObjectTarget,
} from "@/components/ontology/object-viewer";
import { OntologyFormDialog } from "@/components/ontology/ontology-form";
import { EmptyState, Page, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import {
  OntologyBadges,
  OntologyStatusLine,
} from "@/components/views/ontology-list-view";
import { guessLang, isComposing } from "@/lib/cjk";
import { api, errorMessage, jsonBody } from "@/lib/client";
import type {
  ActionAuditEntry,
  ObjectPage,
  ObjectTypeDetail,
  ObjectTypeSummary,
  OntologySchema,
  OntologyStatus,
  PublicOntology,
} from "@/lib/ontology/types";
import { cn } from "@/lib/utils";

type Schema = OntologySchema & { errors?: string[] };

/* -------------------------------------------------------- object types */

function ObjectsPanel({
  type,
  ontology,
  onOpen,
}: {
  type: ObjectTypeDetail;
  ontology: string;
  onOpen: (target: ObjectTarget) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<ObjectPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (text: string, pageToken?: string) => {
      setLoading(true);
      setError(null);
      try {
        const next = await api<ObjectPage>(
          `${ontologyPath(ontology)}/objects`,
          {
            method: "POST",
            body: jsonBody({
              objectType: type.apiName,
              text: text.trim() || undefined,
              limit: 25,
              pageToken,
            }),
          },
        );
        setPage((current) =>
          pageToken && current
            ? { ...next, objects: [...current.objects, ...next.objects] }
            : next,
        );
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
      }
    },
    [ontology, type.apiName],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the first page per type
    void load("");
  }, [load]);

  const columns = type.properties
    .filter(
      (p) => p.apiName !== type.primaryKey && p.apiName !== type.titleProperty,
    )
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isComposing(event))
              event.preventDefault();
          }}
          placeholder={t("onto.type.search")}
          aria-label={t("onto.type.search")}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label={t("onto.type.search")}
        >
          <SearchIcon />
        </Button>
      </form>
      {error ? (
        <p className="text-destructive text-sm break-all">{error}</p>
      ) : null}
      {page ? (
        <>
          <p className="text-muted-foreground text-xs">
            {page.totalCount !== undefined
              ? t("onto.type.count", { count: page.totalCount })
              : null}
          </p>
          {page.objects.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">
                      {type.properties.find(
                        (p) => p.apiName === type.primaryKey,
                      )?.displayName ?? type.primaryKey}
                    </th>
                    {type.titleProperty !== type.primaryKey ? (
                      <th className="px-2 py-1.5 font-medium">
                        {type.properties.find(
                          (p) => p.apiName === type.titleProperty,
                        )?.displayName ?? type.titleProperty}
                      </th>
                    ) : null}
                    {columns.map((column) => (
                      <th
                        key={column.apiName}
                        className="px-2 py-1.5 font-medium"
                      >
                        {column.displayName ?? column.apiName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.objects.map((object) => (
                    <tr
                      key={String(object.primaryKey)}
                      className="hover:bg-muted/50 cursor-pointer border-t"
                      onClick={() =>
                        onOpen({
                          ontology,
                          objectType: type.apiName,
                          primaryKey: object.primaryKey,
                        })
                      }
                    >
                      <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                        {String(object.primaryKey)}
                      </td>
                      {type.titleProperty !== type.primaryKey ? (
                        <td
                          className="max-w-64 truncate px-2 py-1.5"
                          lang={guessLang(object.title ?? "")}
                        >
                          {object.title}
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td
                          key={column.apiName}
                          className="max-w-48 truncate px-2 py-1.5"
                        >
                          {formatValue(object.properties[column.apiName])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("onto.type.noObjects")}
            </p>
          )}
          {page.nextPageToken ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={loading}
              onClick={() => void load(query, page.nextPageToken)}
            >
              {loading ? <Spinner /> : null}
              {t("onto.type.loadMore")}
            </Button>
          ) : null}
        </>
      ) : loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </p>
      ) : null}
    </div>
  );
}

function TypeDetail({
  ontology,
  apiName,
  onSelect,
  onOpen,
}: {
  ontology: string;
  apiName: string;
  onSelect: (apiName: string) => void;
  onOpen: (target: ObjectTarget) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<ObjectTypeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per type
    setType(null);
    setError(null);
    api<ObjectTypeDetail>(
      `${ontologyPath(ontology)}/object-types/${encodeURIComponent(apiName)}`,
    )
      .then(setType)
      .catch((reason) => setError(errorMessage(reason)));
  }, [ontology, apiName]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!type) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> {t("common.loading")}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-baseline gap-2 font-semibold">
          {type.displayName}
          <span className="text-muted-foreground font-mono text-xs font-normal">
            {type.apiName}
          </span>
        </h2>
        {type.description ? (
          <p className="text-muted-foreground text-sm">{type.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="outline">
            <KeyRoundIcon />
            {t("onto.type.pk")}: {type.primaryKey}
          </Badge>
          <Badge variant="outline">
            {t("onto.type.title")}: {type.titleProperty}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t("onto.type.objects")}</p>
        <ObjectsPanel type={type} ontology={ontology} onOpen={onOpen} />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t("onto.properties")}</p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="px-2 py-1.5 font-medium">
                  {t("onto.col.apiName")}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t("onto.col.name")}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t("onto.col.type")}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t("onto.col.description")}
                </th>
              </tr>
            </thead>
            <tbody>
              {type.properties.map((property) => (
                <tr key={property.apiName} className="border-t">
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {property.apiName}
                  </td>
                  <td className="px-2 py-1.5">{property.displayName}</td>
                  <td className="text-muted-foreground px-2 py-1.5 font-mono text-xs">
                    {property.type}
                  </td>
                  <td className="text-muted-foreground px-2 py-1.5 text-xs">
                    {property.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t("onto.links")}</p>
        {type.links.length ? (
          <ul className="flex flex-wrap gap-2">
            {type.links.map((link) => (
              <li key={link.apiName}>
                <button
                  type="button"
                  onClick={() => onSelect(link.target)}
                  className="hover:bg-muted flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                >
                  <LinkIcon className="text-muted-foreground size-3.5" />
                  {link.displayName}
                  <span className="text-muted-foreground font-mono text-xs">
                    → {link.target} · {link.cardinality}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("onto.none")}</p>
        )}
      </div>
    </div>
  );
}

function ObjectTypesTab({
  connection,
  schema,
  onOpen,
}: {
  connection: PublicOntology;
  schema: Schema | null;
  onOpen: (target: ObjectTarget) => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const types = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (schema?.objectTypes ?? []).filter(
      (type) =>
        !query ||
        `${type.apiName} ${type.displayName} ${type.description ?? ""}`
          .toLowerCase()
          .includes(query),
    );
  }, [schema, filter]);
  const current = selected ?? types[0]?.apiName ?? null;

  if (!schema) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> {t("common.loading")}
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("onto.types.search")}
          aria-label={t("onto.types.search")}
        />
        <ul className="flex max-h-[28rem] flex-col overflow-y-auto">
          {types.map((type: ObjectTypeSummary) => (
            <li key={type.apiName}>
              <button
                type="button"
                onClick={() => setSelected(type.apiName)}
                aria-current={current === type.apiName ? "true" : undefined}
                className={cn(
                  "hover:bg-muted flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                  current === type.apiName && "bg-muted",
                )}
              >
                <BoxIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <span
                    className="truncate text-sm"
                    lang={guessLang(type.displayName)}
                  >
                    {type.displayName}
                  </span>
                  <span className="text-muted-foreground truncate font-mono text-[11px]">
                    {type.apiName}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!types.length ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              {t("onto.types.empty")}
            </li>
          ) : null}
        </ul>
      </div>
      <div className="min-w-0">
        {current ? (
          <TypeDetail
            key={current}
            ontology={connection.id}
            apiName={current}
            onSelect={setSelected}
            onOpen={onOpen}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("onto.type.select")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ functions, actions */

function LogicTab({ schema }: { schema: Schema | null }) {
  const { t } = useI18n();
  if (!schema) return null;
  const signature = (
    parameters: { name: string; type: string; required: boolean }[],
  ) =>
    parameters
      .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`)
      .join(", ");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title={t("onto.functions", { count: schema.functions.length })}>
        {schema.functions.length ? (
          <ul className="flex flex-col gap-3">
            {schema.functions.map((fn) => (
              <li key={fn.apiName} className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {fn.displayName || fn.apiName}{" "}
                  <span className="text-muted-foreground font-mono text-xs font-normal">
                    v{fn.version}
                  </span>
                </span>
                <code className="text-muted-foreground font-mono text-xs break-all">
                  {fn.apiName}({signature(fn.parameters)}) → {fn.output}
                </code>
                {fn.description ? (
                  <span className="text-muted-foreground text-xs">
                    {fn.description}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("onto.none")}</p>
        )}
      </Section>
      <Section title={t("onto.actions", { count: schema.actionTypes.length })}>
        {schema.actionTypes.length ? (
          <ul className="flex flex-col gap-3">
            {schema.actionTypes.map((action) => (
              <li key={action.apiName} className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {action.displayName || action.apiName}
                </span>
                <code className="text-muted-foreground font-mono text-xs break-all">
                  {action.apiName}({signature(action.parameters)})
                </code>
                {action.description ? (
                  <span className="text-muted-foreground text-xs">
                    {action.description}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("onto.none")}</p>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- settings */

function AllowlistEditor({
  connection,
  onSaved,
}: {
  connection: PublicOntology;
  onSaved: (connection: PublicOntology) => void;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState<ObjectTypeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>(connection.objectTypes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ objectTypes: ObjectTypeSummary[] }>(
      `${ontologyPath(connection.id)}/schema?all=1`,
    )
      .then((result) =>
        setAll(
          [...result.objectTypes].sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
        ),
      )
      .catch((reason) => setError(errorMessage(reason)));
  }, [connection.id]);

  const dirty =
    [...picked].sort().join(",") !==
    [...connection.objectTypes].sort().join(",");

  const save = async () => {
    setSaving(true);
    try {
      const { connection: saved } = await api<{ connection: PublicOntology }>(
        "/api/ontology",
        {
          method: "POST",
          body: jsonBody({
            id: connection.id,
            name: connection.name,
            description: connection.description,
            baseUrl: connection.baseUrl,
            ontology: connection.ontology,
            auth: connection.auth,
            clientId: connection.clientId,
            scopes: connection.scopes ?? [],
            allowActions: connection.allowActions,
            allowFunctions: connection.allowFunctions,
            objectTypes: picked,
          }),
        },
      );
      toast.add({ title: t("common.saved") });
      onSaved(saved);
    } catch (reason) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(reason),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={t("onto.allowlist")}
      description={t("onto.allowlist.hint")}
      actions={
        connection.source === "settings" ? (
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        ) : null
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {!all && !error ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {all?.map((type) => (
          <CheckField
            key={type.apiName}
            checked={picked.includes(type.apiName)}
            disabled={connection.source !== "settings"}
            onChange={(checked) =>
              setPicked(
                checked
                  ? [...picked, type.apiName]
                  : picked.filter((item) => item !== type.apiName),
              )
            }
            hint={type.apiName}
          >
            {type.displayName}
          </CheckField>
        ))}
      </div>
    </Section>
  );
}

function AuditTab({ id }: { id: string }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ActionAuditEntry[] | null>(null);
  useEffect(() => {
    api<{ entries: ActionAuditEntry[] }>(`${ontologyPath(id)}/audit`)
      .then((result) => setEntries(result.entries))
      .catch(() => setEntries([]));
  }, [id]);
  if (!entries) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> {t("common.loading")}
      </p>
    );
  }
  if (!entries.length) {
    return (
      <p className="text-muted-foreground text-sm">{t("onto.audit.empty")}</p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <li
          key={index}
          className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{entry.action}</span>
            <Badge
              variant={
                entry.outcome === "applied"
                  ? "success"
                  : entry.outcome === "invalid"
                    ? "warning"
                    : "destructive"
              }
            >
              {t(`onto.audit.${entry.outcome}`)}
            </Badge>
            <span className="text-muted-foreground ml-auto text-xs">
              {new Date(entry.at).toLocaleString()}
            </span>
          </div>
          <code className="text-muted-foreground font-mono text-xs break-all">
            {JSON.stringify(entry.parameters)}
          </code>
          {entry.edits ? (
            <span className="text-muted-foreground text-xs">
              {t("action.appliedEdits", {
                modified: entry.edits.modified,
                added: entry.edits.added,
                deleted: entry.edits.deleted,
              })}
            </span>
          ) : null}
          {entry.message ? (
            <span className="text-destructive text-xs">{entry.message}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------- view */

export function OntologyDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { ontologies, refreshOntologies } = useWorkspace();
  const [connection, setConnection] = useState<PublicOntology | null>(null);
  const [status, setStatus] = useState<OntologyStatus | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<ObjectTarget | null>(null);
  const [tab, setTab] = useState("objects");

  const load = useCallback(
    async (refresh = false) => {
      setStatus(null);
      setSchema(null);
      try {
        const result = await api<{
          connection: PublicOntology;
          status: OntologyStatus;
        }>(`${ontologyPath(id)}${refresh ? "?refresh=1" : ""}`);
        setConnection(result.connection);
        setStatus(result.status);
        if (result.status.ok) {
          setSchema(await api<Schema>(`${ontologyPath(id)}/schema`));
        }
      } catch (reason) {
        setError(errorMessage(reason));
      }
    },
    [id],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  const remove = async () => {
    if (!connection) return;
    if (!window.confirm(t("onto.delete.confirm", { name: connection.name })))
      return;
    try {
      await api(ontologyPath(connection.id), { method: "DELETE" });
      await refreshOntologies();
      router.push("/ontology");
    } catch (reason) {
      toast.add({
        title: t("common.error"),
        description: errorMessage(reason),
        type: "error",
      });
    }
  };

  if (error) {
    return (
      <Page title={t("onto.title")}>
        <EmptyState title={t("common.error")} description={error} />
      </Page>
    );
  }

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("onto.back")}
            nativeButton={false}
            render={<Link href="/ontology" />}
          >
            <ArrowLeftIcon />
          </Button>
          {connection?.name ?? "…"}
        </span>
      }
      description={connection ? <OntologyStatusLine status={status} /> : null}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void load(true)}>
            <RefreshCwIcon />
            {t("common.refresh")}
          </Button>
          {connection?.source === "settings" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <PencilIcon />
                {t("common.edit")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void remove()}>
                <Trash2Icon />
                {t("common.delete")}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {connection ? <OntologyBadges connection={connection} /> : null}
      {schema?.errors?.length ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {schema.errors.join(" · ")}
        </p>
      ) : null}
      {connection ? (
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="objects">{t("onto.tab.objects")}</TabsTrigger>
            <TabsTrigger value="logic">{t("onto.tab.logic")}</TabsTrigger>
            <TabsTrigger value="settings">{t("onto.tab.settings")}</TabsTrigger>
            <TabsTrigger value="audit">{t("onto.tab.audit")}</TabsTrigger>
          </TabsList>
          <TabsContent value="objects">
            {status && !status.ok ? null : (
              <ObjectTypesTab
                connection={connection}
                schema={schema}
                onOpen={setViewing}
              />
            )}
          </TabsContent>
          <TabsContent value="logic">
            <LogicTab schema={schema} />
          </TabsContent>
          <TabsContent value="settings">
            {status?.ok ? (
              <AllowlistEditor
                key={connection.objectTypes.join(",")}
                connection={connection}
                onSaved={(saved) => {
                  setConnection(saved);
                  void refreshOntologies();
                  void load();
                }}
              />
            ) : null}
          </TabsContent>
          <TabsContent value="audit">
            <AuditTab id={connection.id} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> {t("common.loading")}
        </p>
      )}
      {editing && connection ? (
        <OntologyFormDialog
          open={editing}
          onOpenChange={setEditing}
          initial={connection}
          onSaved={(saved) => {
            setConnection(saved);
            void refreshOntologies();
            void load(true);
          }}
        />
      ) : null}
      <OntologyViewer
        source={null}
        object={viewing}
        ontologies={ontologies}
        onClose={() => setViewing(null)}
      />
    </Page>
  );
}
