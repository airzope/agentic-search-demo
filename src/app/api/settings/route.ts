import { badRequest, handle } from "@/lib/meili";
import type { SettingsPatch } from "@/lib/providers";
import { getPublicSettings, updateSettings } from "@/lib/settings";

export async function GET() {
  return handle(async () => Response.json(await getPublicSettings()));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const patch = (await request.json()) as SettingsPatch;
    if (!patch || typeof patch !== "object") return badRequest("Invalid body");
    return Response.json(await updateSettings(patch));
  });
}
