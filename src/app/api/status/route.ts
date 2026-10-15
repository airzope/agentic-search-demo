import { getMeili } from "@/lib/meili";
import { getMeilisearchConfig, resolveActiveProviderId } from "@/lib/settings";
import type { StatusInfo } from "@/lib/types";

export async function GET() {
  const { host } = await getMeilisearchConfig();
  let meilisearch: StatusInfo["meilisearch"];
  try {
    const version = await (await getMeili()).getVersion();
    meilisearch = { ok: true, host, version: version.pkgVersion };
  } catch (error) {
    meilisearch = {
      ok: false,
      host,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return Response.json({
    meilisearch,
    llm: { active: await resolveActiveProviderId() },
  } satisfies StatusInfo);
}
