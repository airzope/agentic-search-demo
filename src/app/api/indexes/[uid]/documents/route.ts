import type { NextRequest } from "next/server";
import type { ContentType } from "meilisearch";

import { badRequest, getMeili, handle, assertIndexUid } from "@/lib/meili";

const CONTENT_TYPES: Record<string, ContentType> = {
  "application/json": "application/json",
  "application/x-ndjson": "application/x-ndjson",
  "application/ndjson": "application/x-ndjson",
  "text/csv": "text/csv",
};

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/indexes/[uid]/documents">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    const params = request.nextUrl.searchParams;
    const limit = Math.min(Number(params.get("limit") ?? 20) || 20, 200);
    const offset = Math.max(Number(params.get("offset") ?? 0) || 0, 0);
    const result = await (
      await getMeili()
    )
      .index(uid)
      .getDocuments({ limit, offset });
    return Response.json(result);
  });
}

/** Import raw JSON / NDJSON / CSV; the body is forwarded as-is. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/indexes/[uid]/documents">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    const mime = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const contentType = CONTENT_TYPES[mime];
    if (!contentType) {
      return badRequest(
        "Use application/json, application/x-ndjson or text/csv.",
      );
    }
    const body = await request.text();
    if (!body.trim()) return badRequest("The file is empty.");
    const params = request.nextUrl.searchParams;
    const task = await (
      await getMeili()
    )
      .index(uid)
      .addDocumentsFromString(body, contentType, {
        primaryKey: params.get("primaryKey") || undefined,
        csvDelimiter: params.get("csvDelimiter") || undefined,
      });
    return Response.json({ taskUid: task.taskUid });
  });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/indexes/[uid]/documents">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    const task = await (await getMeili()).index(uid).deleteAllDocuments();
    return Response.json({ taskUid: task.taskUid });
  });
}
