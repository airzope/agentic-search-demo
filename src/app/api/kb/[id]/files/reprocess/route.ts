import { reprocessFiles } from "@/lib/kb/jobs";
import { badRequest, handle, kbIdParam } from "@/lib/meili";

/** Convert the given files again (e.g. after OCR settings changed). */
export async function POST(
  request: Request,
  context: RouteContext<"/api/kb/[id]/files/reprocess">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const { paths } = (await request.json()) as { paths?: string[] };
    if (!paths?.length) return badRequest("paths is required");
    return Response.json(reprocessFiles(id, paths));
  });
}
