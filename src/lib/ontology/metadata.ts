import "server-only";

import {
  ActionTypesV2,
  ObjectTypesV2,
  QueryTypes,
  type ActionTypeV2,
  type ObjectTypeV2,
  type QueryTypeV2,
} from "@osdk/foundry.ontologies";

import { singleton } from "@/lib/global";
import { BadRequestError } from "@/lib/meili";
import { osdkSession, type OsdkSession } from "@/lib/ontology/client";
import type { OntologyConnection } from "@/lib/ontology/store";
import type {
  ActionTypeSummary,
  FunctionSummary,
  ObjectTypeDetail,
  ObjectTypeSummary,
  OntologySchema,
  ParameterSummary,
} from "@/lib/ontology/types";

/**
 * Ontology metadata (object types, links, actions, functions), cached for a
 * few minutes per connection. Large ontologies list thousands of types, so the
 * agent searches this cache instead of loading everything into the prompt.
 */
const TTL_MS = 5 * 60_000;
const MAX_ITEMS = 5000;

const cache = singleton(
  "ontology-metadata",
  () => new Map<string, { at: number; value: Promise<unknown> }>(),
);

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function clearOntologyMetadata(id: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${id}|`)) cache.delete(key);
  }
}

const cacheKey = (connection: OntologyConnection, kind: string) =>
  `${connection.id}|${connection.baseUrl}|${connection.ontology}|${kind}`;

/** Follow `nextPageToken` until done (or MAX_ITEMS). */
async function collect<T>(
  page: (pageToken?: string) => Promise<{ data: T[]; nextPageToken?: string }>,
) {
  const items: T[] = [];
  let token: string | undefined;
  do {
    const result = await page(token);
    items.push(...result.data);
    token = result.nextPageToken;
  } while (token && items.length < MAX_ITEMS);
  return items;
}

type AnyType = { type: string; [key: string]: unknown };

/** Readable data type: `string`, `array<date>`, `object<Employee>`. */
export function formatType(value: unknown): string {
  const type = value as AnyType | undefined;
  if (!type?.type) return "unknown";
  switch (type.type) {
    case "array":
    case "set":
      return `${type.type}<${formatType(type.subType)}>`;
    case "object":
    case "objectSet":
    case "objectType":
      return type.objectTypeApiName
        ? `${type.type}<${String(type.objectTypeApiName)}>`
        : type.type;
    case "interfaceObject":
    case "interfaceObjectSet":
      return `${type.type}<${String(type.interfaceTypeApiName ?? "")}>`;
    case "struct": {
      const fields = (
        (type.fields ?? type.structFieldTypes ?? []) as {
          name?: string;
          apiName?: string;
          fieldType?: unknown;
          dataType?: unknown;
        }[]
      )
        .map(
          (field) =>
            `${field.name ?? field.apiName}: ${formatType(field.fieldType ?? field.dataType)}`,
        )
        .join(", ");
      return `struct{${fields}}`;
    }
    case "union":
      return ((type.unionTypes ?? []) as unknown[]).map(formatType).join(" | ");
    case "entrySet":
      return `map<${formatType(type.keyType)}, ${formatType(type.valueType)}>`;
    case "typeReference":
      return String(type.typeId ?? "reference");
    default:
      return type.type;
  }
}

function summarizeObjectType(type: ObjectTypeV2): ObjectTypeSummary {
  const icon = type.icon as { name?: string; color?: string } | undefined;
  return {
    apiName: type.apiName,
    displayName: type.displayName,
    pluralDisplayName: type.pluralDisplayName,
    description: type.description || undefined,
    primaryKey: type.primaryKey,
    titleProperty: type.titleProperty,
    status: type.status,
    propertyCount: Object.keys(type.properties ?? {}).length,
    icon: icon?.name ? { name: icon.name, color: icon.color ?? "" } : undefined,
  };
}

const parameters = (
  record: Record<
    string,
    {
      displayName?: string;
      description?: string;
      dataType: unknown;
      required: boolean;
    }
  >,
): ParameterSummary[] =>
  Object.entries(record ?? {}).map(([name, parameter]) => ({
    name,
    displayName: parameter.displayName,
    description: parameter.description || undefined,
    type: formatType(parameter.dataType),
    required: parameter.required,
  }));

const summarizeAction = (action: ActionTypeV2): ActionTypeSummary => ({
  apiName: action.apiName,
  displayName: action.displayName,
  description: action.description || action.toolDescription || undefined,
  status: action.status,
  parameters: parameters(action.parameters),
});

const summarizeFunction = (query: QueryTypeV2): FunctionSummary => ({
  apiName: query.apiName,
  displayName: query.displayName,
  description: query.description || undefined,
  version: query.version,
  parameters: parameters(
    query.parameters as Record<
      string,
      { description?: string; dataType: unknown; required: boolean }
    >,
  ),
  output: formatType(query.output),
});

/** True when the connection lets the assistant use this object type. */
export function objectTypeAllowed(
  connection: OntologyConnection,
  apiName: string,
) {
  const allowed = connection.objectTypes ?? [];
  return !allowed.length || allowed.includes(apiName);
}

async function allObjectTypes(
  connection: OntologyConnection,
  session: OsdkSession,
) {
  return cached(cacheKey(connection, "objectTypes"), () =>
    collect((pageToken) =>
      ObjectTypesV2.list(session.client, session.ontology.rid, {
        pageSize: 500,
        pageToken,
      }),
    ),
  );
}

/** Object types (filtered by the connection's allowlist). */
export async function listObjectTypes(connection: OntologyConnection) {
  const session = await osdkSession(connection);
  return (await allObjectTypes(connection, session))
    .filter((type) => objectTypeAllowed(connection, type.apiName))
    .map(summarizeObjectType)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Every object type the credentials can see, ignoring the allowlist. */
export async function listAllObjectTypes(connection: OntologyConnection) {
  const session = await osdkSession(connection);
  return (await allObjectTypes(connection, session)).map(summarizeObjectType);
}

export function assertObjectTypeAllowed(
  connection: OntologyConnection,
  apiName: string,
) {
  if (!objectTypeAllowed(connection, apiName)) {
    throw new BadRequestError(
      `Object type "${apiName}" is not enabled for ${connection.name}.`,
    );
  }
}

/** Properties and links of one object type. */
export async function getObjectType(
  connection: OntologyConnection,
  apiName: string,
): Promise<ObjectTypeDetail> {
  assertObjectTypeAllowed(connection, apiName);
  const session = await osdkSession(connection);
  return cached(cacheKey(connection, `type:${apiName}`), async () => {
    const full = await ObjectTypesV2.getFullMetadata(
      session.client,
      session.ontology.rid,
      apiName,
      { preview: true },
    );
    const type = full.objectType;
    return {
      ...summarizeObjectType(type),
      properties: Object.entries(type.properties ?? {}).map(
        ([name, property]) => ({
          apiName: name,
          displayName: property.displayName,
          description: property.description || undefined,
          type: formatType(property.dataType),
        }),
      ),
      links: (full.linkTypes ?? [])
        .filter((link) => objectTypeAllowed(connection, link.objectTypeApiName))
        .map((link) => ({
          apiName: link.apiName,
          displayName: link.displayName,
          target: link.objectTypeApiName,
          cardinality: link.cardinality,
        })),
    };
  });
}

export async function listActionTypes(connection: OntologyConnection) {
  const session = await osdkSession(connection);
  return cached(cacheKey(connection, "actions"), async () =>
    (
      await collect((pageToken) =>
        ActionTypesV2.list(session.client, session.ontology.rid, {
          pageSize: 500,
          pageToken,
        }),
      )
    ).map(summarizeAction),
  );
}

export async function listFunctions(connection: OntologyConnection) {
  const session = await osdkSession(connection);
  return cached(cacheKey(connection, "functions"), async () =>
    (
      await collect((pageToken) =>
        QueryTypes.list(session.client, session.ontology.rid, {
          pageSize: 500,
          pageToken,
        }),
      )
    ).map(summarizeFunction),
  );
}

/** Object types, actions and functions; a failing part becomes empty. */
export async function getSchema(
  connection: OntologyConnection,
): Promise<OntologySchema & { errors: string[] }> {
  const errors: string[] = [];
  const settle = async <T>(promise: Promise<T[]>, label: string) => {
    try {
      return await promise;
    } catch (error) {
      errors.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [] as T[];
    }
  };
  const objectTypes = await listObjectTypes(connection);
  const [actionTypes, functions] = await Promise.all([
    settle(listActionTypes(connection), "actions"),
    settle(listFunctions(connection), "functions"),
  ]);
  return { objectTypes, actionTypes, functions, errors };
}

/** Rank object types for a keyword query (API name, names, description). */
export function matchObjectTypes(types: ObjectTypeSummary[], query: string) {
  const terms = query
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(Boolean);
  if (!terms.length) return types;
  return types
    .map((type) => {
      const name =
        `${type.apiName} ${type.displayName} ${type.pluralDisplayName ?? ""}`.toLowerCase();
      const description = (type.description ?? "").toLowerCase();
      const score = terms.reduce(
        (sum, term) =>
          sum +
          (name.includes(term) ? 3 : 0) +
          (description.includes(term) ? 1 : 0),
        0,
      );
      return { type, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.type);
}
