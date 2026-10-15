import type { NextRequest } from "next/server";

import { readDocument } from "@/lib/kb/browse";
import { badRequest, handle, kbIdParam } from "@/lib/meili";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]/docs/[docId]">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const { docId } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,511}$/.test(docId))
      return badRequest("Invalid document id");
    const params = request.nextUrl.searchParams;
    const around = params.get("around");
    return Response.json(
      await readDocument(id, docId, {
        around: around !== null && /^\d+$/.test(around) ? Number(around) : null,
        window: Number(params.get("window") ?? 2) || 2,
        maxChars: Math.min(
          Number(params.get("maxChars") ?? 60000) || 60000,
          200000,
        ),
      }),
    );
  });
}
