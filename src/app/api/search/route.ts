import { retrieve } from "@/lib/kb/retrieve";
import { badRequest, handle, parseKbId } from "@/lib/meili";
import type { SearchPrefs } from "@/lib/types";

type SearchBody = Partial<SearchPrefs> & {
  /** Knowledge base ids (`connection:index`); several means federated search. */
  kbs?: string[];
  q?: string;
  branch?: string | null;
  filter?: string | (string | string[])[];
  facets?: string[];
  limit?: number;
  offset?: number;
};

export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as SearchBody;
    const kbIds = (body.kbs ?? []).map((id) => parseKbId(id).id);
    if (!kbIds.length) return badRequest("Select at least one knowledge base");
    const result = await retrieve({
      kbIds,
      q: body.q ?? "",
      prefs: body,
      branch: body.branch,
      filter: body.filter,
      facets: body.facets,
      limit: body.limit,
      offset: body.offset,
    });
    return Response.json(result);
  });
}
