/** Ontology (Palantir Foundry) types shared by API routes and pages. */

export type OntologyAuthType = "token" | "oauth";

/** A connection as shown in the UI: secrets are replaced by hints. */
export type PublicOntology = {
  id: string;
  name: string;
  description?: string;
  /** Foundry stack, e.g. https://example.palantirfoundry.com */
  baseUrl: string;
  /** Ontology RID or API name as configured. */
  ontology: string;
  auth: OntologyAuthType;
  tokenHint: string | null;
  clientId?: string;
  scopes?: string[];
  /** Object types the assistant may use; empty means all visible ones. */
  objectTypes: string[];
  /** Let the assistant propose actions (always applied by a person). */
  allowActions: boolean;
  /** Let the assistant run Foundry functions (query types). */
  allowFunctions: boolean;
  /** `env` connections come from FOUNDRY_* variables and are read-only. */
  source: "settings" | "env";
};

/** Body of create / update / test requests. Empty secrets keep the saved ones. */
export type OntologyInput = {
  id: string;
  name?: string;
  description?: string;
  baseUrl: string;
  ontology: string;
  auth: OntologyAuthType;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  objectTypes?: string[];
  allowActions?: boolean;
  allowFunctions?: boolean;
};

export type OntologyInfo = {
  apiName: string;
  displayName: string;
  description?: string;
  rid: string;
};

export type OntologyStatus =
  | {
      ok: true;
      ontology: OntologyInfo;
      objectTypes: number;
      actionTypes: number;
      functions: number;
    }
  | { ok: false; error: string };

export type PropertySummary = {
  apiName: string;
  displayName?: string;
  description?: string;
  /** Readable data type, e.g. `string`, `array<date>`. */
  type: string;
};

export type LinkSummary = {
  apiName: string;
  displayName: string;
  /** Target object type API name. */
  target: string;
  cardinality: "ONE" | "MANY";
};

export type ObjectTypeSummary = {
  apiName: string;
  displayName: string;
  pluralDisplayName?: string;
  description?: string;
  primaryKey: string;
  titleProperty: string;
  status?: string;
  propertyCount: number;
  icon?: { name: string; color: string };
};

export type ObjectTypeDetail = ObjectTypeSummary & {
  properties: PropertySummary[];
  links: LinkSummary[];
};

export type ParameterSummary = {
  name: string;
  displayName?: string;
  description?: string;
  type: string;
  required: boolean;
};

export type ActionTypeSummary = {
  apiName: string;
  displayName?: string;
  description?: string;
  status?: string;
  parameters: ParameterSummary[];
};

export type FunctionSummary = {
  apiName: string;
  displayName?: string;
  description?: string;
  version: string;
  parameters: ParameterSummary[];
  output: string;
};

export type OntologySchema = {
  objectTypes: ObjectTypeSummary[];
  actionTypes: ActionTypeSummary[];
  functions: FunctionSummary[];
};

/** An ontology object as plain JSON. */
export type OntologyObject = {
  objectType: string;
  primaryKey: string | number;
  title?: string;
  rid?: string;
  properties: Record<string, unknown>;
};

export type ObjectPage = {
  objects: OntologyObject[];
  nextPageToken?: string;
  totalCount?: number;
  /** The OSDK call that produced the page, for provenance. */
  query: string;
};

/** An executed or rejected action, kept in the audit log. */
export type ActionAuditEntry = {
  at: string;
  ontology: string;
  action: string;
  parameters: Record<string, unknown>;
  outcome: "applied" | "invalid" | "failed";
  message?: string;
  edits?: {
    added: number;
    modified: number;
    deleted: number;
    objectTypes: string[];
  };
};

/** Object Explorer link for an object RID. */
export const foundryObjectUrl = (baseUrl: string, rid?: string) =>
  rid ? `${baseUrl}/workspace/hubble/objects/${encodeURIComponent(rid)}` : "";
