import { steerRun } from "@/lib/agent/run";
import { badRequest, handle } from "@/lib/meili";

/**
 * Add guidance to a chat run in progress. The agent picks it up after the
 * current tool calls finish; `{ accepted: false }` means the run had ended.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { id, text } = (await request.json()) as {
      id?: string;
      text?: string;
    };
    if (!id || !text?.trim()) return badRequest("id and text are required");
    return Response.json({ accepted: steerRun(id, text.trim()) });
  });
}
