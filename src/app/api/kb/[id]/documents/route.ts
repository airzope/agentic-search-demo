import type { ContentType } from "meilisearch";
import type { NextRequest } from "next/server";

import { invalidateKb } from "@/lib/kb/catalog";
import { badRequest, getKbIndex, handle, kbIdParam } from "@/lib/meili";

const CONTENT_TYPES: Record<string, ContentType> = {
  "application/json": "application/json",
  "application/x-ndjson": "application/x-ndjson",
  "application/ndjson": "application/x-ndjson",
  "text/csv": "text/csv",
};

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]/documents">,
) {
  return handle(async () => {
    const { index } = await getKbIndex(await kbIdParam(context.params));
    const params = request.nextUrl.searchParams;
    const limit = Math.min(Number(params.get("limit") ?? 20) || 20, 200);
    const offset = Math.max(Number(params.get("offset") ?? 0) || 0, 0);
    return Response.json(await index.getDocuments({ limit, offset }));
  });
}

/** Import raw JSON / NDJSON / CSV records (not files); the body is forwarded as-is. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]/documents">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const mime = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const contentType = CONTENT_TYPES[mime];
    if (!contentType)
      return badRequest(
        "Use application/json, application/x-ndjson or text/csv.",
      );
    const body = await request.text();
    if (!body.trim()) return badRequest("The file is empty.");
    const params = request.nextUrl.searchParams;
    const { index } = await getKbIndex(id);
    const task = await index.addDocumentsFromString(body, contentType, {
      primaryKey: params.get("primaryKey") || undefined,
      csvDelimiter: params.get("csvDelimiter") || undefined,
    });
    invalidateKb(id);
    return Response.json({ taskUid: task.taskUid });
  });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/kb/[id]/documents">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const { index } = await getKbIndex(id);
    const task = await index.deleteAllDocuments();
    invalidateKb(id);
    return Response.json({ taskUid: task.taskUid });
  });
}
