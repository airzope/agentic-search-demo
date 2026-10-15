import { readAudit } from "@/lib/ontology/audit";
import { connectionParam, handleOntology } from "@/lib/ontology/http";

/** Actions applied from this app, newest first. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/ontology/[id]/audit">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    return Response.json({ entries: await readAudit(connection.id) });
  });
}
