import { closeOsdkSession, osdkSession } from "@/lib/ontology/client";
import { connectionParam, handleOntology } from "@/lib/ontology/http";
import {
  clearOntologyMetadata,
  listActionTypes,
  listFunctions,
  listObjectTypes,
} from "@/lib/ontology/metadata";
import {
  deleteOntologyConnection,
  toPublicOntology,
} from "@/lib/ontology/store";
import type { OntologyStatus } from "@/lib/ontology/types";
import { foundryErrorMessage } from "@/lib/ontology/client";

/** A connection and its live status (`?refresh=1` drops cached metadata). */
export async function GET(
  request: Request,
  context: RouteContext<"/api/ontology/[id]">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    if (new URL(request.url).searchParams.get("refresh")) {
      closeOsdkSession(connection.id);
      clearOntologyMetadata(connection.id);
    }
    let status: OntologyStatus;
    try {
      const session = await osdkSession(connection);
      const count = async (load: Promise<unknown[]>) => {
        try {
          return (await load).length;
        } catch {
          return 0;
        }
      };
      const [objectTypes, actionTypes, functions] = await Promise.all([
        listObjectTypes(connection).then((items) => items.length),
        count(listActionTypes(connection)),
        count(listFunctions(connection)),
      ]);
      status = {
        ok: true,
        ontology: session.ontology,
        objectTypes,
        actionTypes,
        functions,
      };
    } catch (error) {
      status = { ok: false, error: foundryErrorMessage(error) };
    }
    return Response.json({ connection: toPublicOntology(connection), status });
  });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/ontology/[id]">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    await deleteOntologyConnection(connection.id);
    closeOsdkSession(connection.id);
    clearOntologyMetadata(connection.id);
    return Response.json({ ok: true });
  });
}
