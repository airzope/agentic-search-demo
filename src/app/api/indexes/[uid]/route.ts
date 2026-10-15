import { getMeili, handle, assertIndexUid } from "@/lib/meili";
import { describeIndex } from "@/lib/search";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/indexes/[uid]">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    const index = (await getMeili()).index(uid);
    return Response.json(await describeIndex(index));
  });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/indexes/[uid]">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    const task = await (await getMeili()).deleteIndex(uid);
    return Response.json({ taskUid: task.taskUid });
  });
}
