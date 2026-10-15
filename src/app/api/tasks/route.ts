import type { NextRequest } from "next/server";

import { assertIndexUid, getMeili, handle, isHiddenIndex } from "@/lib/meili";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const indexUid = params.get("indexUid")
      ? assertIndexUid(params.get("indexUid"))
      : null;
    const limit = Math.min(Number(params.get("limit") ?? 20) || 20, 100);
    const client = await getMeili();
    const { results } = await client.tasks.getTasks({
      limit: limit * 2,
      ...(indexUid ? { indexUids: [indexUid] } : {}),
    });
    const tasks = results
      .filter((task) => !task.indexUid || !isHiddenIndex(task.indexUid))
      .slice(0, limit);
    return Response.json({ tasks });
  });
}
