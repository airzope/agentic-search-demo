import type { Settings } from "meilisearch";

import {
  EDITABLE_SETTINGS,
  badRequest,
  getMeili,
  handle,
  assertIndexUid,
} from "@/lib/meili";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/indexes/[uid]/settings">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    return Response.json(await (await getMeili()).index(uid).getSettings());
  });
}

/** Partial settings update; only known keys are forwarded. */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/indexes/[uid]/settings">,
) {
  return handle(async () => {
    const uid = assertIndexUid((await context.params).uid);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") return badRequest("Invalid body");
    const unknown = Object.keys(body).filter(
      (key) => !(EDITABLE_SETTINGS as readonly string[]).includes(key),
    );
    if (unknown.length) {
      return badRequest(`Unsupported settings: ${unknown.join(", ")}`);
    }
    const task = await (
      await getMeili()
    )
      .index(uid)
      .updateSettings(body as Settings);
    return Response.json({ taskUid: task.taskUid });
  });
}
