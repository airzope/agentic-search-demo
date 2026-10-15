import { startSync } from "@/lib/kb/jobs";
import { handle, kbIdParam } from "@/lib/meili";

/**
 * Start an incremental sync. `{ "force": true }` also retries failed files;
 * `{ "rebuild": true }` clears the index and re-processes every file.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/kb/[id]/sync">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
      rebuild?: boolean;
    };
    return Response.json(
      startSync(id, {
        force: Boolean(body.force),
        rebuild: Boolean(body.rebuild),
      }),
    );
  });
}
