import { startSync } from "@/lib/kb/jobs";
import { updateKnowledgeBase } from "@/lib/kb/manage";
import { getKbConfig } from "@/lib/kb/registry";
import { badRequest, handle, kbIdParam } from "@/lib/meili";

/** Add files or folders of a mapped directory to the exclude rules, then sync. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/kb/[id]/files/exclude">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const config = await getKbConfig(id);
    if (config?.source.type !== "directory") {
      return badRequest("Only directory knowledge bases have exclude rules");
    }
    const { paths } = (await request.json()) as { paths?: string[] };
    const added = (paths ?? []).map((item) => item.trim()).filter(Boolean);
    if (!added.length) return badRequest("paths is required");
    const exclude = [...new Set([...config.source.exclude, ...added])];
    const { config: updated } = await updateKnowledgeBase(id, {
      source: { exclude },
    });
    return Response.json({ config: updated, job: startSync(id) });
  });
}
