import "server-only";

import { createHash } from "node:crypto";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type { SourceNumbers } from "@/lib/agent/tools";
import type {
  ActionProposalOutput,
  OntologyObjectsOutput,
  OntologySchemaOutput,
  Source,
} from "@/lib/agent/types";
import {
  getObjectType,
  listActionTypes,
  listFunctions,
  listObjectTypes,
  matchObjectTypes,
} from "@/lib/ontology/metadata";
import {
  aggregateObjects,
  executeFunction,
  findObjects,
  linkedObjects,
  validateAction,
  type GroupBy,
  type Metric,
} from "@/lib/ontology/query";
import type { OntologyConnection } from "@/lib/ontology/store";
import {
  foundryObjectUrl,
  type ObjectPage,
  type ObjectTypeDetail,
  type OntologyObject,
  type ParameterSummary,
} from "@/lib/ontology/types";

/**
 * Ontology tools for the chat agent. Reads go through the OSDK client; every
 * object, aggregation and function result gets a citation number, and keeps
 * the OSDK call that produced it so answers can be traced and re-run.
 * Actions are only validated here: a person applies them from the chat.
 */

const MAX_PROPERTIES = 40;

const hash = (value: string) =>
  createHash("sha1").update(value).digest("hex").slice(0, 12);

const objectRef = (ontology: string, type: string, key: string | number) =>
  `onto~${ontology}~${type}~${encodeURIComponent(String(key))}`;

const short = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > 80 ? `${text.slice(0, 80)}…` : (text ?? "");
};

/** "title — prop: value; prop: value" for lists and verification. */
function snippetOf(object: OntologyObject, type: ObjectTypeDetail) {
  const labels = new Map(
    type.properties.map((p) => [p.apiName, p.displayName || p.apiName]),
  );
  return Object.entries(object.properties)
    .filter(
      ([key, value]) =>
        key !== type.titleProperty && value !== null && value !== "",
    )
    .slice(0, 8)
    .map(([key, value]) => `${labels.get(key) ?? key}: ${short(value)}`)
    .join("; ");
}

const signature = (parameters: ParameterSummary[]) =>
  parameters
    .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`)
    .join(", ");

export function createOntologyTools({
  connections,
  numbers,
}: {
  connections: OntologyConnection[];
  numbers: SourceNumbers;
}): AgentTool[] {
  const byId = new Map(connections.map((c) => [c.id, c]));
  const ids = connections.map((c) => c.id).join(", ");

  const pick = (id?: string) => {
    if (!id) {
      if (connections.length === 1) return connections[0];
      throw new Error(`Pass "ontology" (one of: ${ids}).`);
    }
    const connection = byId.get(id);
    if (!connection) throw new Error(`Unknown ontology "${id}". Use: ${ids}`);
    return connection;
  };

  const at = () => new Date().toISOString();

  const objectSources = (
    connection: OntologyConnection,
    type: ObjectTypeDetail,
    page: ObjectPage,
    select?: string[],
  ): Source[] => {
    // Properties the snapshot covers; null values are not returned by Foundry.
    const fields = (select ?? type.properties.map((p) => p.apiName)).slice(
      0,
      MAX_PROPERTIES,
    );
    return page.objects.map((object) => {
      const ref = objectRef(connection.id, type.apiName, object.primaryKey);
      const properties = Object.fromEntries(
        Object.entries(object.properties).filter(([key]) =>
          fields.includes(key),
        ),
      );
      return {
        n: numbers.number(ref),
        ref,
        kind: "object",
        ontology: connection.id,
        ontologyName: connection.name,
        objectType: type.apiName,
        objectTypeName: type.displayName,
        primaryKey: object.primaryKey,
        title: object.title ?? String(object.primaryKey),
        snippet: snippetOf(object, type),
        properties,
        fields,
        url: foundryObjectUrl(connection.baseUrl, object.rid) || undefined,
        query: page.query,
        at: at(),
      };
    });
  };

  /** What the model sees: numbers and data, without links or UI fields. */
  const objectsForModel = (output: OntologyObjectsOutput) =>
    JSON.stringify({
      objectType: output.objectType,
      query: output.query,
      totalCount: output.totalCount,
      hasMore: output.hasMore,
      ...(output.via ? { via: output.via } : {}),
      objects: output.objects.map((object) => ({
        n: object.n,
        primaryKey: object.primaryKey,
        title: object.title,
        properties: object.properties,
      })),
    });

  const ontologyParam = Type.Optional(
    Type.String({
      description: `Ontology connection id (${ids}); optional when only one is selected`,
    }),
  );
  const whereParam = Type.Optional(
    Type.Record(Type.String(), Type.Any(), {
      description:
        'OSDK where clause using property apiNames, e.g. {"status":{"$eq":"open"},"amount":{"$gte":1000}}. Operators: $eq $ne $gt $gte $lt $lte $in $isNull $startsWith $containsAllTerms $containsAnyTerm; combine with $and / $or / $not.',
    }),
  );

  const schema: AgentTool = {
    name: "ontology_schema",
    label: "Ontology schema",
    description:
      "Explore the ontology: without objectType, list object types (filtered by `search`), functions and actions; with objectType, get its exact property apiNames, types and links. Call this before querying an object type you have not inspected.",
    parameters: Type.Object({
      ontology: ontologyParam,
      objectType: Type.Optional(
        Type.String({ description: "Object type apiName to describe" }),
      ),
      search: Type.Optional(
        Type.String({
          description: "Keywords to find object types (names, descriptions)",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { ontology, objectType, search } = params as {
        ontology?: string;
        objectType?: string;
        search?: string;
      };
      const connection = pick(ontology);
      const output: OntologySchemaOutput = {
        ontology: connection.id,
        ontologyName: connection.name,
      };
      if (objectType) {
        output.objectType = await getObjectType(connection, objectType);
      } else {
        const types = await listObjectTypes(connection);
        const matched = search ? matchObjectTypes(types, search) : types;
        output.totalObjectTypes = types.length;
        output.objectTypes = matched.slice(0, 60).map((type) => ({
          apiName: type.apiName,
          displayName: type.displayName,
          description: type.description?.slice(0, 200),
        }));
        if (connection.allowFunctions !== false) {
          output.functions = (await listFunctions(connection).catch(() => []))
            .slice(0, 40)
            .map((fn) => ({
              apiName: fn.apiName,
              description: fn.description?.slice(0, 200),
              parameters: signature(fn.parameters),
              output: fn.output,
            }));
        }
        if (connection.allowActions) {
          output.actions = (await listActionTypes(connection).catch(() => []))
            .slice(0, 40)
            .map((action) => ({
              apiName: action.apiName,
              description: action.description?.slice(0, 200),
              parameters: signature(action.parameters),
            }));
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        details: output,
      };
    },
  };

  const find: AgentTool = {
    name: "ontology_find",
    label: "Find objects",
    description:
      "Load ontology objects of one type, filtered by an OSDK where clause, full-text `text`, or `primaryKeys`. Each object has a citation number `n`. totalCount/hasMore tell whether you saw everything.",
    parameters: Type.Object({
      ontology: ontologyParam,
      objectType: Type.String({ description: "Object type apiName" }),
      where: whereParam,
      text: Type.Optional(
        Type.String({ description: "Full-text terms over string properties" }),
      ),
      primaryKeys: Type.Optional(
        Type.Array(Type.Union([Type.String(), Type.Number()]), {
          maxItems: 100,
        }),
      ),
      orderBy: Type.Optional(
        Type.Record(
          Type.String(),
          Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
          {
            description: 'e.g. {"amount":"desc"}',
          },
        ),
      ),
      select: Type.Optional(
        Type.Array(Type.String(), {
          description: "Only these properties (smaller results)",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 100, description: "Default 20" }),
      ),
    }),
    execute: async (_id, params) => {
      const args = params as {
        ontology?: string;
        objectType: string;
        where?: unknown;
        text?: string;
        primaryKeys?: (string | number)[];
        orderBy?: Record<string, string>;
        select?: string[];
        limit?: number;
      };
      const connection = pick(args.ontology);
      const page = await findObjects(connection, args);
      const output: OntologyObjectsOutput = {
        ontology: connection.id,
        ontologyName: connection.name,
        objectType: page.type.apiName,
        objectTypeName: page.type.displayName,
        query: page.query,
        totalCount: page.totalCount,
        hasMore: Boolean(page.nextPageToken),
        objects: objectSources(connection, page.type, page, page.select),
      };
      return {
        content: [{ type: "text", text: objectsForModel(output) }],
        details: output,
      };
    },
  };

  const links: AgentTool = {
    name: "ontology_links",
    label: "Follow links",
    description:
      "Load the objects linked to one object through a link type (see the links in ontology_schema). Linked objects get citation numbers too.",
    parameters: Type.Object({
      ontology: ontologyParam,
      objectType: Type.String({ description: "Type of the starting object" }),
      primaryKey: Type.Union([Type.String(), Type.Number()]),
      link: Type.String({ description: "Link apiName" }),
      where: whereParam,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    execute: async (_id, params) => {
      const args = params as {
        ontology?: string;
        objectType: string;
        primaryKey: string | number;
        link: string;
        where?: unknown;
        limit?: number;
      };
      const connection = pick(args.ontology);
      const page = await linkedObjects(connection, args);
      const output: OntologyObjectsOutput = {
        ontology: connection.id,
        ontologyName: connection.name,
        objectType: page.type.apiName,
        objectTypeName: page.type.displayName,
        query: page.query,
        totalCount: page.totalCount,
        hasMore: Boolean(page.nextPageToken),
        objects: objectSources(connection, page.type, page),
        via: {
          objectType: page.source.apiName,
          primaryKey: args.primaryKey,
          link: args.link,
        },
      };
      return {
        content: [{ type: "text", text: objectsForModel(output) }],
        details: output,
      };
    },
  };

  const aggregate: AgentTool = {
    name: "ontology_aggregate",
    label: "Aggregate",
    description:
      "Compute counts, sums, averages, min/max or distinct counts over objects in Foundry, optionally grouped. Use it for every total or statistic instead of adding values yourself; the result has one citation number.",
    parameters: Type.Object({
      ontology: ontologyParam,
      objectType: Type.String(),
      where: whereParam,
      metrics: Type.Array(
        Type.Object({
          op: Type.Union(
            [
              "count",
              "sum",
              "avg",
              "min",
              "max",
              "approximateDistinct",
              "exactDistinct",
            ].map((op) => Type.Literal(op)),
          ),
          property: Type.Optional(
            Type.String({ description: "Required except for count" }),
          ),
        }),
        { minItems: 1, maxItems: 8 },
      ),
      groupBy: Type.Optional(
        Type.Array(
          Type.Object({
            property: Type.String(),
            mode: Type.Optional(
              Type.Union(
                ["exact", "fixedWidth", "ranges", "duration"].map((mode) =>
                  Type.Literal(mode),
                ),
              ),
            ),
            limit: Type.Optional(
              Type.Integer({ description: "Max groups (exact), default 50" }),
            ),
            width: Type.Optional(Type.Number({ description: "fixedWidth" })),
            ranges: Type.Optional(
              Type.Array(Type.Array(Type.Any(), { minItems: 2, maxItems: 2 }), {
                description: "[[start, end], …] for ranges",
              }),
            ),
            duration: Type.Optional(
              Type.Array(Type.Any(), {
                description: 'e.g. [1, "months"] for dates',
              }),
            ),
          }),
          { maxItems: 3 },
        ),
      ),
    }),
    execute: async (_id, params) => {
      const args = params as {
        ontology?: string;
        objectType: string;
        where?: unknown;
        metrics: Metric[];
        groupBy?: GroupBy[];
      };
      const connection = pick(args.ontology);
      const result = await aggregateObjects(connection, args);
      const ref = `onto~${connection.id}~agg~${hash(result.query)}`;
      const groups = args.groupBy?.map((g) => g.property).join(", ");
      const output: Source = {
        n: numbers.number(ref),
        ref,
        kind: "aggregate",
        ontology: connection.id,
        ontologyName: connection.name,
        objectType: result.type.apiName,
        objectTypeName: result.type.displayName,
        title: `${result.type.displayName}: ${result.table.columns
          .slice(args.groupBy?.length ?? 0)
          .join(", ")}${groups ? ` / ${groups}` : ""}`,
        table: result.table,
        query: result.query,
        at: at(),
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              n: output.n,
              objectType: output.objectType,
              query: output.query,
              columns: result.table.columns,
              rows: result.table.rows,
              truncated: result.table.truncated,
            }),
          },
        ],
        details: output,
      };
    },
  };

  const tools = [schema, find, links, aggregate];

  if (connections.some((c) => c.allowFunctions !== false)) {
    tools.push({
      name: "ontology_function",
      label: "Run function",
      description:
        "Run a Foundry function (query type) with parameters; use it when the ontology defines business logic for the question (scores, forecasts, rules). The result has one citation number.",
      parameters: Type.Object({
        ontology: ontologyParam,
        function: Type.String({ description: "Function apiName" }),
        parameters: Type.Optional(Type.Record(Type.String(), Type.Any())),
      }),
      execute: async (_id, params) => {
        const args = params as {
          ontology?: string;
          function: string;
          parameters?: Record<string, unknown>;
        };
        const connection = pick(args.ontology);
        const result = await executeFunction(
          connection,
          args.function,
          args.parameters ?? {},
        );
        const ref = `onto~${connection.id}~fn~${hash(result.query)}`;
        const preview = JSON.stringify(result.value) ?? "null";
        const output: Source = {
          n: numbers.number(ref),
          ref,
          kind: "function",
          ontology: connection.id,
          ontologyName: connection.name,
          title: result.definition.displayName || result.definition.apiName,
          snippet: preview.slice(0, 600),
          value: result.value,
          query: result.query,
          at: at(),
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                n: output.n,
                function: args.function,
                output: result.definition.output,
                value: result.value,
              }).slice(0, 20_000),
            },
          ],
          details: output,
        };
      },
    });
  }

  if (connections.some((c) => c.allowActions)) {
    tools.push({
      name: "ontology_propose_action",
      label: "Propose action",
      description:
        "Propose an ontology action (a write) for the user to approve. It is only validated here, never applied: the user reviews the parameters and applies it. Only use it when the user asks for a change.",
      parameters: Type.Object({
        ontology: ontologyParam,
        action: Type.String({ description: "Action apiName" }),
        parameters: Type.Record(Type.String(), Type.Any()),
        reason: Type.String({
          description: "Why, citing the sources that justify it",
        }),
      }),
      execute: async (_id, params) => {
        const args = params as {
          ontology?: string;
          action: string;
          parameters: Record<string, unknown>;
          reason: string;
        };
        const connection = pick(args.ontology);
        if (!connection.allowActions) {
          throw new Error(`Actions are disabled for ${connection.name}.`);
        }
        const { definition, validation } = await validateAction(
          connection,
          args.action,
          args.parameters,
        );
        const output: ActionProposalOutput = {
          ontology: connection.id,
          ontologyName: connection.name,
          action: definition.apiName,
          actionName: definition.displayName,
          description: definition.description,
          parameters: args.parameters,
          parameterInfo: definition.parameters,
          validation,
          reason: args.reason,
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                proposed: true,
                applied: false,
                validation,
                note: "Waiting for the user to approve it in the interface.",
              }),
            },
          ],
          details: output,
        };
      },
    });
  }

  return tools;
}

/** Short ontology catalog for the system prompt. */
export async function ontologyCatalog(connections: OntologyConnection[]) {
  const lines = await Promise.all(
    connections.map(async (connection) => {
      try {
        const types = await listObjectTypes(connection);
        const shown = types
          .slice(0, 40)
          .map((type) =>
            type.displayName && type.displayName !== type.apiName
              ? `${type.apiName}(${type.displayName})`
              : type.apiName,
          )
          .join(", ");
        const more =
          types.length > 40
            ? `, … +${types.length - 40} more (use ontology_schema with search)`
            : "";
        const abilities = [
          connection.allowFunctions !== false ? "functions" : null,
          connection.allowActions ? "action proposals" : null,
        ]
          .filter(Boolean)
          .join(", ");
        const description = connection.description
          ? ` — ${connection.description}`
          : "";
        return `- ${connection.id} — ${connection.name}${description} — ${types.length} object types${abilities ? `; ${abilities}` : ""}\n  Object types: ${shown}${more}`;
      } catch (error) {
        return `- ${connection.id} — ${connection.name} — unavailable (${error instanceof Error ? error.message : String(error)})`;
      }
    }),
  );
  return lines.join("\n");
}

export const ONTOLOGY_RULES = `Ontology rules (Palantir Foundry via OSDK) — the ontology is the system of record:
- Facts about objects (property values, relationships, counts, totals) must come from ontology tool results in this conversation. Cite the object, aggregate or function number for each, e.g. 供应商 华东精密 的评级为 A[4]。
- Before querying an object type you have not inspected, call ontology_schema with objectType to get exact property apiNames and links. Never guess property names or values; when unsure of a value's spelling, look it up first (text search or exact group-by).
- Compute counts, sums, averages, min/max with ontology_aggregate and cite it. Do not add up or count listed objects yourself unless you saw all of them (hasMore is false).
- Follow relationships with ontology_links; never assert a relationship that was not returned.
- Prefer a Foundry function (ontology_function) when one encodes the business logic asked about.
- When a result is partial (hasMore, truncated), say so. When a filter returns nothing, state the filter you used before concluding that nothing exists.
- Separate facts from reasoning: mark conclusions you derive from several facts as inference (推断), and name the facts they rest on.
- Before answering, re-check every number in your answer against the tool results.
- Writes: never claim that something was changed. ontology_propose_action only validates a proposal; the user approves and applies it in the interface.`;
