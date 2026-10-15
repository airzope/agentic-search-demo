import { badRequest, getMeili, handle, settle } from "@/lib/meili";
import { getSampleDataset } from "@/lib/samples";

/** Create (or refresh) a demo index with recommended CJK settings. */
export async function POST(request: Request) {
  return handle(async () => {
    const { dataset: id } = (await request.json()) as { dataset?: string };
    const dataset = id ? getSampleDataset(id) : undefined;
    if (!dataset) return badRequest("Unknown dataset");

    const client = await getMeili();
    const index = client.index(dataset.indexUid);
    try {
      await index.getRawInfo();
    } catch {
      await settle(client.createIndex(dataset.indexUid, { primaryKey: "id" }));
    }
    await settle(index.updateSettings(dataset.settings));
    await settle(index.addDocuments(dataset.documents, { primaryKey: "id" }));
    return Response.json({
      uid: dataset.indexUid,
      documents: dataset.documents.length,
    });
  });
}
