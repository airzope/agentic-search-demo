import type { NextRequest } from "next/server";

import { listJobs } from "@/lib/kb/jobs";
import { handle, parseKbId } from "@/lib/meili";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const kb = request.nextUrl.searchParams.get("kb");
    return Response.json({ jobs: listJobs(kb ? parseKbId(kb).id : undefined) });
  });
}
