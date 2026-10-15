import {
  connectionParam,
  handleOntology,
  segmentParam,
} from "@/lib/ontology/http";
import { getObjectType } from "@/lib/ontology/metadata";

/** Properties and links of an object type. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/ontology/[id]/object-types/[type]">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    const type = segmentParam((await context.params).type);
    return Response.json(await getObjectType(connection, type));
  });
}
