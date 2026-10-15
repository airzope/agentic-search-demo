import type { NextRequest } from "next/server";

import { getProvider, listModels } from "@/lib/llm";
import { badRequest, handle } from "@/lib/meili";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const id = request.nextUrl.searchParams.get("provider");
    if (!id) return badRequest("Missing provider");
    const provider = await getProvider(id);
    return Response.json({ models: await listModels(provider) });
  });
}
