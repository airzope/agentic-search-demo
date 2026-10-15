import type { NextRequest } from "next/server";

import { browseTree } from "@/lib/kb/browse";
import { handle, kbIdParam } from "@/lib/meili";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]/tree">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const branch = request.nextUrl.searchParams.get("branch") || null;
    return Response.json(await browseTree(id, branch));
  });
}
