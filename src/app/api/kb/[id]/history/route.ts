import { readSyncHistory } from "@/lib/kb/jobs";
import { handle, kbIdParam } from "@/lib/meili";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/kb/[id]/history">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    return Response.json({ history: await readSyncHistory(id) });
  });
}
