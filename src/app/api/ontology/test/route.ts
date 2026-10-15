import {
  foundryErrorMessage,
  listOntologies,
  testSession,
} from "@/lib/ontology/client";
import { handleOntology } from "@/lib/ontology/http";
import {
  getOntologyConnection,
  mergeOntologyInput,
} from "@/lib/ontology/store";
import type { OntologyInfo, OntologyInput } from "@/lib/ontology/types";

/**
 * Test settings before saving them: open an OSDK session and count object
 * types. On failure, list the ontologies the credentials can see.
 */
export async function POST(request: Request) {
  return handleOntology(async () => {
    const input = (await request.json()) as OntologyInput;
    const existing = input.id ? await getOntologyConnection(input.id) : null;
    const connection = mergeOntologyInput(
      { ...input, ontology: input.ontology || "-" },
      existing,
    );
    let ontologies: OntologyInfo[] = [];
    try {
      ontologies = await listOntologies(connection);
    } catch (error) {
      return Response.json({ ok: false, error: foundryErrorMessage(error) });
    }
    if (!input.ontology?.trim()) {
      return Response.json({ ok: false, ontologies, error: null });
    }
    try {
      const session = await testSession(connection);
      const { ObjectTypesV2 } = await import("@osdk/foundry.ontologies");
      const page = await ObjectTypesV2.list(
        session.client,
        session.ontology.rid,
        { pageSize: 500 },
      );
      return Response.json({
        ok: true,
        ontology: session.ontology,
        ontologies,
        objectTypes: page.data.length,
        more: Boolean(page.nextPageToken),
      });
    } catch (error) {
      return Response.json({
        ok: false,
        ontologies,
        error: foundryErrorMessage(error),
      });
    }
  });
}
