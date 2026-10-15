import { connectionParam, handleOntology } from "@/lib/ontology/http";
import { findObjects, type FindArgs } from "@/lib/ontology/query";

/** Load a page of objects: `{ objectType, where?, text?, primaryKeys?, orderBy?, limit?, pageToken? }`. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/ontology/[id]/objects">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    const args = (await request.json()) as FindArgs;
    const { type: _type, ...page } = await findObjects(connection, args);
    void _type;
    return Response.json(page);
  });
}
