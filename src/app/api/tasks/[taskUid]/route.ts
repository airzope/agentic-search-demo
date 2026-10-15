import { badRequest, getMeili, handle } from "@/lib/meili";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/tasks/[taskUid]">,
) {
  return handle(async () => {
    const { taskUid } = await context.params;
    const uid = Number(taskUid);
    if (!Number.isInteger(uid) || uid < 0) return badRequest("Invalid task");
    const task = await (await getMeili()).tasks.getTask(uid);
    return Response.json(task);
  });
}
