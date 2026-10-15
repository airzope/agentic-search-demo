import "server-only";

import { BadRequestError } from "@/lib/meili";
import { foundryErrorMessage } from "@/lib/ontology/client";
import { ONTOLOGY_ID, requireOntologyConnection } from "@/lib/ontology/store";

/** Route wrapper: input errors → 400, Foundry / OSDK errors → 502. */
export async function handleOntology(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BadRequestError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[ontology]", error);
    return Response.json(
      { error: foundryErrorMessage(error) },
      { status: 502 },
    );
  }
}

const decode = (value: string) => {
  try {
    return value.includes("%") ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
};

export async function connectionParam(params: Promise<{ id: string }>) {
  const id = decode((await params).id);
  if (!ONTOLOGY_ID.test(id)) throw new BadRequestError("Invalid ontology id");
  return requireOntologyConnection(id);
}

export const segmentParam = decode;
