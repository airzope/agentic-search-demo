import { connectionParam, handleOntology } from "@/lib/ontology/http";
import { linkedObjects, type LinkArgs } from "@/lib/ontology/query";

/** Objects linked to one object: `{ objectType, primaryKey, link, limit? }`. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/ontology/[id]/links">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    const args = (await request.json()) as LinkArgs;
    const page = await linkedObjects(connection, args);
    return Response.json({
      objects: page.objects,
      nextPageToken: page.nextPageToken,
      query: page.query,
      objectType: page.type.apiName,
    });
  });
}
