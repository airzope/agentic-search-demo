import "server-only";

import { BadRequestError } from "@/lib/meili";
import { osdkSession, type OsdkSession } from "@/lib/ontology/client";
import {
  assertObjectTypeAllowed,
  getObjectType,
  listActionTypes,
  listFunctions,
  objectTypeAllowed,
} from "@/lib/ontology/metadata";
import type { OntologyConnection } from "@/lib/ontology/store";
import type {
  ObjectPage,
  ObjectTypeDetail,
  OntologyObject,
} from "@/lib/ontology/types";

/**
 * Ontology reads and writes through the OSDK client (`@osdk/client`), with
 * definitions created at runtime from the ontology metadata, so any ontology
 * works without a generated SDK. Every call also returns its OSDK code, which
 * the UI shows as provenance.
 */

type WireObject = Record<string, unknown> & {
  $apiName?: string;
  $primaryKey?: string | number;
  $title?: string;
  $rid?: string;
};

type Page = {
  data: WireObject[];
  nextPageToken?: string;
  totalCount?: string | number;
};

/** The subset of the OSDK ObjectSet API used here, for untyped definitions. */
type DynamicObjectSet = {
  where(clause: unknown): DynamicObjectSet;
  pivotTo(link: string): DynamicObjectSet;
  fetchPage(args?: Record<string, unknown>): Promise<Page>;
  aggregate(args: Record<string, unknown>): Promise<unknown>;
};

type Invoker = (definition: Record<string, unknown>) => unknown;

const objectSet = (session: OsdkSession, apiName: string) =>
  (session.client as unknown as Invoker)({
    type: "object",
    apiName,
  }) as DynamicObjectSet;

const json = (value: unknown) => JSON.stringify(value);

/* --------------------------------------------------------------- values */

const MAX_STRING = 1000;
const MAX_ARRAY = 50;

/** OSDK values (attachments, time series, dates…) as plain JSON. */
export function jsonValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => jsonValue(item, depth + 1));
    return value.length > MAX_ARRAY
      ? [...items, `… ${value.length - MAX_ARRAY} more`]
      : items;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.fetchMetadata === "function") {
      return { attachment: record.rid ?? null };
    }
    if (typeof record.getFirstPoint === "function") return "[time series]";
    if (typeof record.getMediaReference === "function") return "[media]";
    if (depth > 4) return "[…]";
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if (typeof item !== "function") out[key] = jsonValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** An OSDK object as plain JSON. */
export function toPlainObject(
  object: WireObject,
  select?: string[],
): OntologyObject {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (key.startsWith("$") || typeof value === "function") continue;
    if (select?.length && !select.includes(key)) continue;
    properties[key] = jsonValue(value);
  }
  return {
    objectType: String(object.$apiName ?? object.$objectType ?? ""),
    primaryKey: object.$primaryKey as string | number,
    title:
      object.$title !== undefined && object.$title !== null
        ? String(object.$title)
        : undefined,
    rid: object.$rid,
    properties,
  };
}

/* -------------------------------------------------------------- filters */

const OPERATORS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$isNull",
  "$startsWith",
  "$containsAllTerms",
  "$containsAnyTerm",
  "$containsAllTermsInOrder",
  "$contains",
]);

const NUMERIC = new Set([
  "integer",
  "long",
  "short",
  "byte",
  "double",
  "float",
  "decimal",
]);

function coerce(value: unknown, type: string): unknown {
  if (Array.isArray(value)) return value.map((item) => coerce(item, type));
  if (NUMERIC.has(type) && typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  if (type === "boolean" && (value === "true" || value === "false")) {
    return value === "true";
  }
  return value;
}

/**
 * Check an OSDK where clause against the object type: unknown properties or
 * operators are errors (with the valid names), so a typo cannot silently
 * return nothing. Numeric strings are coerced for numeric properties.
 */
export function checkWhere(
  where: unknown,
  type: ObjectTypeDetail,
): Record<string, unknown> | undefined {
  if (where === undefined || where === null) return undefined;
  if (typeof where !== "object" || Array.isArray(where)) {
    throw new BadRequestError("where must be an object");
  }
  const types = new Map(type.properties.map((p) => [p.apiName, p.type]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "$and" || key === "$or") {
      if (!Array.isArray(value))
        throw new BadRequestError(`${key} takes an array`);
      out[key] = value.map((item) => checkWhere(item, type) ?? {});
      continue;
    }
    if (key === "$not") {
      out[key] = checkWhere(value, type) ?? {};
      continue;
    }
    if (key.startsWith("$")) {
      throw new BadRequestError(`Unknown where key "${key}"`);
    }
    const propertyType = types.get(key);
    if (!propertyType) {
      throw new BadRequestError(
        `${type.apiName} has no property "${key}". Properties: ${[...types.keys()].join(", ")}`,
      );
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      if (value === null || value === undefined) {
        out[key] = { $isNull: true };
      } else if (Array.isArray(value)) {
        out[key] = { $in: coerce(value, propertyType) };
      } else {
        out[key] = { $eq: coerce(value, propertyType) };
      }
      continue;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length !== 1) {
      throw new BadRequestError(
        `Use one operator per property (combine with $and): ${key}`,
      );
    }
    const [operator, operand] = entries[0];
    if (!OPERATORS.has(operator)) {
      throw new BadRequestError(
        `Unknown operator "${operator}". Use one of ${[...OPERATORS].join(", ")}.`,
      );
    }
    out[key] = {
      [operator]:
        operator === "$isNull"
          ? Boolean(operand)
          : coerce(operand, propertyType),
    };
  }
  return out;
}

/** Full-text match on the string properties (title first). */
function textWhere(text: string, type: ObjectTypeDetail) {
  const fields = type.properties
    .filter((property) => property.type === "string")
    .sort(
      (a, b) =>
        Number(b.apiName === type.titleProperty) -
        Number(a.apiName === type.titleProperty),
    )
    .slice(0, 8)
    .map((property) => ({
      [property.apiName]: { $containsAllTerms: text },
    }));
  if (!fields.length) {
    throw new BadRequestError(`${type.apiName} has no text properties`);
  }
  return fields.length === 1 ? fields[0] : { $or: fields };
}

function checkProperties(names: string[] | undefined, type: ObjectTypeDetail) {
  if (!names?.length) return undefined;
  const known = new Set(type.properties.map((p) => p.apiName));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length) {
    throw new BadRequestError(
      `${type.apiName} has no property ${unknown.join(", ")}. Properties: ${[...known].join(", ")}`,
    );
  }
  return names;
}

function checkOrderBy(
  orderBy: Record<string, string> | undefined,
  type: ObjectTypeDetail,
) {
  if (!orderBy || !Object.keys(orderBy).length) return undefined;
  checkProperties(Object.keys(orderBy), type);
  return Object.fromEntries(
    Object.entries(orderBy).map(([key, direction]) => [
      key,
      direction === "desc" ? "desc" : "asc",
    ]),
  );
}

function primaryKeyValues(keys: unknown[], type: ObjectTypeDetail) {
  const pkType =
    type.properties.find((p) => p.apiName === type.primaryKey)?.type ??
    "string";
  return keys.map((key) => coerce(key, pkType));
}

/* -------------------------------------------------------------- objects */

export type FindArgs = {
  objectType: string;
  where?: unknown;
  text?: string;
  primaryKeys?: unknown[];
  orderBy?: Record<string, string>;
  select?: string[];
  limit?: number;
  pageToken?: string;
};

const toPage = (page: Page, query: string, select?: string[]): ObjectPage => ({
  objects: page.data.map((object) => toPlainObject(object, select)),
  nextPageToken: page.nextPageToken,
  totalCount:
    page.totalCount !== undefined && page.totalCount !== null
      ? Number(page.totalCount)
      : undefined,
  query,
});

export async function findObjects(
  connection: OntologyConnection,
  args: FindArgs,
): Promise<
  ObjectPage & { type: ObjectTypeDetail; select: string[] | undefined }
> {
  const type = await getObjectType(connection, args.objectType);
  const clauses: Record<string, unknown>[] = [];
  const where = checkWhere(args.where, type);
  if (where && Object.keys(where).length) clauses.push(where);
  if (args.text?.trim()) clauses.push(textWhere(args.text.trim(), type));
  if (args.primaryKeys?.length) {
    clauses.push({
      [type.primaryKey]: { $in: primaryKeyValues(args.primaryKeys, type) },
    });
  }
  const clause =
    clauses.length === 0
      ? undefined
      : clauses.length === 1
        ? clauses[0]
        : { $and: clauses };
  const select = checkProperties(args.select, type);
  // The primary key and title stay in a narrowed selection.
  const fullSelect = select
    ? [...new Set([type.primaryKey, type.titleProperty, ...select])]
    : undefined;
  const orderBy = checkOrderBy(args.orderBy, type);
  const fetchArgs: Record<string, unknown> = {
    $pageSize: Math.min(Math.max(args.limit ?? 20, 1), 100),
    $includeRid: true,
    ...(orderBy ? { $orderBy: orderBy } : {}),
    ...(fullSelect ? { $select: fullSelect } : {}),
    ...(args.pageToken ? { $nextPageToken: args.pageToken } : {}),
  };
  const session = await osdkSession(connection);
  let set = objectSet(session, type.apiName);
  if (clause) set = set.where(clause);
  const page = await set.fetchPage(fetchArgs);
  const query = `client(${type.apiName})${clause ? `.where(${json(clause)})` : ""}.fetchPage(${json(fetchArgs)})`;
  return { ...toPage(page, query, fullSelect), type, select: fullSelect };
}

export type LinkArgs = {
  objectType: string;
  primaryKey: unknown;
  link: string;
  where?: unknown;
  limit?: number;
};

/** Objects linked to one object, through a link type. */
export async function linkedObjects(
  connection: OntologyConnection,
  args: LinkArgs,
): Promise<ObjectPage & { type: ObjectTypeDetail; source: ObjectTypeDetail }> {
  const source = await getObjectType(connection, args.objectType);
  const link = source.links.find((item) => item.apiName === args.link);
  if (!link) {
    throw new BadRequestError(
      `${source.apiName} has no link "${args.link}". Links: ${source.links.map((item) => `${item.apiName} → ${item.target}`).join(", ") || "none"}`,
    );
  }
  const target = await getObjectType(connection, link.target);
  const [primaryKey] = primaryKeyValues([args.primaryKey], source);
  const from = { [source.primaryKey]: { $eq: primaryKey } };
  const where = checkWhere(args.where, target);
  const fetchArgs = {
    $pageSize: Math.min(Math.max(args.limit ?? 20, 1), 100),
    $includeRid: true,
  };
  const session = await osdkSession(connection);
  let set = objectSet(session, source.apiName)
    .where(from)
    .pivotTo(link.apiName);
  if (where && Object.keys(where).length) set = set.where(where);
  const page = await set.fetchPage(fetchArgs);
  const query = `client(${source.apiName}).where(${json(from)}).pivotTo(${json(link.apiName)})${where && Object.keys(where).length ? `.where(${json(where)})` : ""}.fetchPage(${json(fetchArgs)})`;
  return { ...toPage(page, query), type: target, source };
}

/* ---------------------------------------------------------- aggregation */

export type Metric = {
  op:
    | "count"
    | "sum"
    | "avg"
    | "min"
    | "max"
    | "approximateDistinct"
    | "exactDistinct";
  property?: string;
};

export type GroupBy = {
  property: string;
  /** exact (default), fixedWidth, ranges or duration buckets. */
  mode?: "exact" | "fixedWidth" | "ranges" | "duration";
  limit?: number;
  width?: number;
  ranges?: [unknown, unknown][];
  duration?: [number, string];
};

export type AggregateArgs = {
  objectType: string;
  where?: unknown;
  metrics: Metric[];
  groupBy?: GroupBy[];
};

export type AggregateTable = {
  columns: string[];
  rows: unknown[][];
  /** Groups beyond the row cap that were dropped. */
  truncated: boolean;
};

const MAX_ROWS = 200;

export const metricLabel = (metric: Metric) =>
  metric.op === "count" ? "count" : `${metric.op}(${metric.property})`;

/** Counts, sums, averages… computed by Foundry (never by the model). */
export async function aggregateObjects(
  connection: OntologyConnection,
  args: AggregateArgs,
): Promise<{ table: AggregateTable; query: string; type: ObjectTypeDetail }> {
  const type = await getObjectType(connection, args.objectType);
  const where = checkWhere(args.where, type);
  const metrics = args.metrics?.length
    ? args.metrics
    : [{ op: "count" as const }];
  const select: Record<string, string> = {};
  for (const metric of metrics) {
    if (metric.op === "count") {
      select.$count = "unordered";
      continue;
    }
    if (!metric.property) {
      throw new BadRequestError(`Metric ${metric.op} needs a property`);
    }
    checkProperties([metric.property], type);
    select[`${metric.property}:${metric.op}`] = "unordered";
  }
  const groupBy: Record<string, unknown> = {};
  for (const group of args.groupBy ?? []) {
    checkProperties([group.property], type);
    switch (group.mode ?? "exact") {
      case "fixedWidth":
        groupBy[group.property] = { $fixedWidth: group.width ?? 1 };
        break;
      case "ranges":
        groupBy[group.property] = { $ranges: group.ranges ?? [] };
        break;
      case "duration":
        groupBy[group.property] = { $duration: group.duration ?? [1, "days"] };
        break;
      default:
        groupBy[group.property] = {
          $exactWithLimit: Math.min(Math.max(group.limit ?? 50, 1), 1000),
        };
    }
  }
  const request = {
    $select: select,
    ...(Object.keys(groupBy).length ? { $groupBy: groupBy } : {}),
  };
  const session = await osdkSession(connection);
  let set = objectSet(session, type.apiName);
  if (where && Object.keys(where).length) set = set.where(where);
  const result = await set.aggregate(request);
  const query = `client(${type.apiName})${where && Object.keys(where).length ? `.where(${json(where)})` : ""}.aggregate(${json(request)})`;

  const groups = (args.groupBy ?? []).map((group) => group.property);
  const columns = [...groups, ...metrics.map(metricLabel)];
  const entries = (Array.isArray(result) ? result : [result]) as Record<
    string,
    unknown
  >[];
  const valueOf = (entry: Record<string, unknown>, metric: Metric) =>
    metric.op === "count"
      ? (entry.$count ?? null)
      : ((entry[metric.property!] as Record<string, unknown> | undefined)?.[
          metric.op
        ] ?? null);
  const rows = entries
    .slice(0, MAX_ROWS)
    .map((entry) => [
      ...groups.map((group) =>
        jsonValue(
          (entry.$group as Record<string, unknown> | undefined)?.[group],
        ),
      ),
      ...metrics.map((metric) => jsonValue(valueOf(entry, metric))),
    ]);
  return {
    table: { columns, rows, truncated: entries.length > MAX_ROWS },
    query,
    type,
  };
}

/* ------------------------------------------------------------ functions */

async function plainResult(value: unknown, depth = 0): Promise<unknown> {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.fetchPage === "function") {
      const page = await (record as unknown as DynamicObjectSet).fetchPage({
        $pageSize: 20,
        $includeRid: true,
      });
      return {
        objectSet: page.data.map((object) => toPlainObject(object)),
        hasMore: Boolean(page.nextPageToken),
      };
    }
    if ("$apiName" in record && "$primaryKey" in record) {
      return toPlainObject(record as WireObject);
    }
    if (Array.isArray(value) && depth < 3) {
      return Promise.all(
        value.slice(0, 100).map((item) => plainResult(item, depth + 1)),
      );
    }
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].map(([key, item]) => [
          String(key),
          jsonValue(item),
        ]),
      );
    }
  }
  return jsonValue(value);
}

/** Run a Foundry function (query type) and return its result as JSON. */
export async function executeFunction(
  connection: OntologyConnection,
  apiName: string,
  parameters: Record<string, unknown>,
) {
  if (connection.allowFunctions === false) {
    throw new BadRequestError(`Functions are disabled for ${connection.name}.`);
  }
  const functions = await listFunctions(connection);
  const definition = functions.find((item) => item.apiName === apiName);
  if (!definition) {
    throw new BadRequestError(
      `Unknown function "${apiName}". Functions: ${functions.map((item) => item.apiName).join(", ") || "none"}`,
    );
  }
  const session = await osdkSession(connection);
  const invoker = (session.client as unknown as Invoker)({
    type: "query",
    apiName,
    isFixedVersion: false,
  }) as { executeFunction: (params: unknown) => Promise<unknown> };
  const value = await invoker.executeFunction(parameters ?? {});
  return {
    value: await plainResult(value),
    definition,
    query: `client(${apiName}).executeFunction(${json(parameters ?? {})})`,
  };
}

/* -------------------------------------------------------------- actions */

export type ActionValidation = {
  result: "VALID" | "INVALID";
  /** Failed submission criteria and parameter constraints. */
  messages: string[];
};

function readValidation(response: unknown): ActionValidation {
  const validation = (response ?? {}) as {
    result?: string;
    submissionCriteria?: {
      result?: string;
      configuredFailureMessage?: string;
    }[];
    parameters?: Record<
      string,
      {
        result?: string;
        required?: boolean;
        evaluatedConstraints?: { type?: string }[];
      }
    >;
  };
  const messages = [
    ...(validation.submissionCriteria ?? [])
      .filter((item) => item.result === "INVALID")
      .map(
        (item) => item.configuredFailureMessage || "Submission criteria failed",
      ),
    ...Object.entries(validation.parameters ?? {})
      .filter(([, item]) => item.result === "INVALID")
      .map(
        ([name, item]) =>
          `${name}: ${
            (item.evaluatedConstraints ?? [])
              .map((c) => c.type)
              .filter(Boolean)
              .join(", ") || "invalid"
          }`,
      ),
  ];
  return {
    result: validation.result === "INVALID" ? "INVALID" : "VALID",
    messages,
  };
}

async function actionInvoker(connection: OntologyConnection, apiName: string) {
  const actions = await listActionTypes(connection);
  const definition = actions.find((item) => item.apiName === apiName);
  if (!definition) {
    throw new BadRequestError(
      `Unknown action "${apiName}". Actions: ${actions.map((item) => item.apiName).join(", ") || "none"}`,
    );
  }
  const session = await osdkSession(connection);
  const invoker = (session.client as unknown as Invoker)({
    type: "action",
    apiName,
  }) as {
    applyAction: (
      params: unknown,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  return { definition, invoker };
}

/** Validate an action without applying it. */
export async function validateAction(
  connection: OntologyConnection,
  apiName: string,
  parameters: Record<string, unknown>,
) {
  const { definition, invoker } = await actionInvoker(connection, apiName);
  const response = await invoker.applyAction(parameters ?? {}, {
    $validateOnly: true,
  });
  return { definition, validation: readValidation(response) };
}

/** Apply an action (only after a person approved it). */
export async function applyAction(
  connection: OntologyConnection,
  apiName: string,
  parameters: Record<string, unknown>,
) {
  if (!connection.allowActions) {
    throw new BadRequestError(`Actions are disabled for ${connection.name}.`);
  }
  const { invoker } = await actionInvoker(connection, apiName);
  try {
    const edits = (await invoker.applyAction(parameters ?? {}, {
      $returnEdits: true,
    })) as
      | {
          type?: string;
          addedObjects?: unknown[];
          modifiedObjects?: unknown[];
          deletedObjects?: unknown[];
          deletedObjectsCount?: number;
          editedObjectTypes?: string[];
        }
      | undefined;
    return {
      ok: true as const,
      edits:
        edits?.type === "edits"
          ? {
              added: edits.addedObjects?.length ?? 0,
              modified: edits.modifiedObjects?.length ?? 0,
              deleted:
                edits.deletedObjectsCount ?? edits.deletedObjects?.length ?? 0,
              objectTypes: edits.editedObjectTypes ?? [],
            }
          : undefined,
    };
  } catch (error) {
    const validation = (error as { validation?: unknown }).validation;
    if (validation) {
      return { ok: false as const, validation: readValidation(validation) };
    }
    throw error;
  }
}

export { objectTypeAllowed, assertObjectTypeAllowed };
