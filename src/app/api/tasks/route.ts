import type { NextRequest } from "next/server";

import { getKbIndex, handle, isHiddenIndex } from "@/lib/meili";

/** Recent Meilisearch tasks of one knowledge base (`?kb=connection:index`). */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const { client, indexUid } = await getKbIndex(params.get("kb"));
    const limit = Math.min(Number(params.get("limit") ?? 20) || 20, 100);
    const { results } = await client.tasks.getTasks({
      limit,
      indexUids: [indexUid],
    });
    return Response.json({
      tasks: results.filter(
        (task) => !task.indexUid || !isHiddenIndex(task.indexUid),
      ),
    });
  });
}
