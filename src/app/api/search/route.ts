import { assertIndexUid, getMeili, handle } from "@/lib/meili";
import { buildSearchParams } from "@/lib/search";
import type { SearchPrefs, SearchResult } from "@/lib/types";

type SearchBody = Partial<SearchPrefs> & {
  indexUid?: string;
  q?: string;
  filter?: string | string[];
  facets?: string[];
  limit?: number;
  offset?: number;
};

export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as SearchBody;
    const index = (await getMeili()).index(assertIndexUid(body.indexUid));
    const response = await index.search(
      body.q ?? "",
      buildSearchParams(body, {
        filter: body.filter?.length ? body.filter : undefined,
        facets: body.facets?.length ? body.facets : undefined,
        limit: Math.min(Math.max(Number(body.limit ?? 20) || 20, 1), 100),
        offset: Math.max(Number(body.offset ?? 0) || 0, 0),
      }),
    );
    const result: SearchResult = {
      hits: response.hits,
      query: response.query,
      processingTimeMs: response.processingTimeMs,
      estimatedTotalHits: response.estimatedTotalHits,
      semanticHitCount: (response as { semanticHitCount?: number })
        .semanticHitCount,
      facetDistribution: response.facetDistribution,
    };
    return Response.json(result);
  });
}
