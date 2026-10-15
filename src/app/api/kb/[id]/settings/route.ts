import type { Settings } from "meilisearch";

import { invalidateKb } from "@/lib/kb/catalog";
import {
  EDITABLE_SETTINGS,
  badRequest,
  getKbIndex,
  handle,
  kbIdParam,
} from "@/lib/meili";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/kb/[id]/settings">,
) {
  return handle(async () => {
    const { index } = await getKbIndex(await kbIdParam(context.params));
    return Response.json(await index.getSettings());
  });
}

/** Partial settings update; only known keys are forwarded. */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/kb/[id]/settings">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") return badRequest("Invalid body");
    const unknown = Object.keys(body).filter(
      (key) => !(EDITABLE_SETTINGS as readonly string[]).includes(key),
    );
    if (unknown.length)
      return badRequest(`Unsupported settings: ${unknown.join(", ")}`);
    const { index } = await getKbIndex(id);
    const task = await index.updateSettings(body as Settings);
    invalidateKb(id);
    return Response.json({ taskUid: task.taskUid });
  });
}
