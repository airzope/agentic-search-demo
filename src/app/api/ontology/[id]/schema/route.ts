import { connectionParam, handleOntology } from "@/lib/ontology/http";
import { getSchema, listAllObjectTypes } from "@/lib/ontology/metadata";

/**
 * Object types, actions and functions. `?all=1` lists every object type the
 * credentials can see (to edit the allowlist).
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/ontology/[id]/schema">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    if (new URL(request.url).searchParams.get("all")) {
      return Response.json({
        objectTypes: await listAllObjectTypes(connection),
      });
    }
    return Response.json(await getSchema(connection));
  });
}
