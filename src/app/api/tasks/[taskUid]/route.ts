import type { NextRequest } from "next/server";

import { badRequest, getMeili, handle, parseKbId } from "@/lib/meili";

/** Task status; `?kb=` picks the connection the task belongs to. */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/tasks/[taskUid]">,
) {
  return handle(async () => {
    const uid = Number((await context.params).taskUid);
    if (!Number.isInteger(uid) || uid < 0) return badRequest("Invalid task");
    const kb = request.nextUrl.searchParams.get("kb");
    const client = await getMeili(kb ? parseKbId(kb).connectionId : undefined);
    return Response.json(await client.tasks.getTask(uid));
  });
}
