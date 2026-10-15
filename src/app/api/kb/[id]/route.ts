import type { NextRequest } from "next/server";

import { describeKb } from "@/lib/kb/catalog";
import { activeJob, latestJob } from "@/lib/kb/jobs";
import {
  deleteKnowledgeBase,
  updateKnowledgeBase,
  type UpdateKbInput,
} from "@/lib/kb/manage";
import { readManifest, sourceRoot } from "@/lib/kb/sync";
import { handle, kbIdParam } from "@/lib/meili";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/kb/[id]">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const kb = await describeKb(id, { fresh: true });
    const manifest = kb.config ? await readManifest(id) : null;
    const failed = manifest
      ? Object.entries(manifest.files)
          .filter(([, entry]) => entry.status === "failed")
          .slice(0, 100)
          .map(([path, entry]) => ({ path, message: entry.message ?? "" }))
      : [];
    return Response.json({
      ...kb,
      root: kb.config ? sourceRoot(kb.config) : null,
      lastSync: manifest?.lastSync ?? null,
      failedFiles: failed,
      job: activeJob(id) ?? latestJob(id),
    });
  });
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const input = (await request.json()) as UpdateKbInput;
    return Response.json(await updateKnowledgeBase(id, input));
  });
}

/** `?keepIndex=1` only unregisters the knowledge base. */
export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    await deleteKnowledgeBase(id, {
      keepIndex: request.nextUrl.searchParams.get("keepIndex") === "1",
    });
    return Response.json({ ok: true });
  });
}
