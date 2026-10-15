import { closeOsdkSession } from "@/lib/ontology/client";
import { handleOntology } from "@/lib/ontology/http";
import { clearOntologyMetadata } from "@/lib/ontology/metadata";
import {
  listOntologyConnections,
  saveOntologyConnection,
  toPublicOntology,
} from "@/lib/ontology/store";
import type { OntologyInput } from "@/lib/ontology/types";

/** Ontology connections (secrets replaced by hints). */
export async function GET() {
  return handleOntology(async () => {
    const connections = await listOntologyConnections();
    return Response.json({ connections: connections.map(toPublicOntology) });
  });
}

/** Create or update a connection. Empty secrets keep the saved ones. */
export async function POST(request: Request) {
  return handleOntology(async () => {
    const input = (await request.json()) as OntologyInput;
    const saved = await saveOntologyConnection(input);
    closeOsdkSession(saved.id);
    clearOntologyMetadata(saved.id);
    return Response.json({ connection: toPublicOntology(saved) });
  });
}
