import {
  badRequest,
  getMeili,
  handle,
  isHiddenIndex,
  isValidIndexUid,
  settle,
} from "@/lib/meili";
import type { IndexSummary } from "@/lib/types";

export async function GET() {
  return handle(async () => {
    const client = await getMeili();
    const [{ results }, stats] = await Promise.all([
      client.getRawIndexes({ limit: 1000 }),
      client.getStats(),
    ]);
    const indexes: IndexSummary[] = results
      .filter((index) => !isHiddenIndex(index.uid))
      .map((index) => ({
        uid: index.uid,
        primaryKey: index.primaryKey ?? null,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
        numberOfDocuments: stats.indexes[index.uid]?.numberOfDocuments ?? 0,
        isIndexing: stats.indexes[index.uid]?.isIndexing ?? false,
      }))
      .sort((a, b) => a.uid.localeCompare(b.uid));
    return Response.json({ indexes });
  });
}

/** Create an index, optionally declaring its languages for CJK segmentation. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as {
      uid?: string;
      primaryKey?: string;
      locales?: string[];
    };
    const uid = body.uid?.trim() ?? "";
    if (!isValidIndexUid(uid) || isHiddenIndex(uid)) {
      return badRequest(
        "Index uid may only contain letters, digits, - and _ (and must not start with __).",
      );
    }
    const client = await getMeili();
    await settle(
      client.createIndex(uid, {
        primaryKey: body.primaryKey?.trim() || undefined,
      }),
    );
    let taskUid: number | null = null;
    const locales = (body.locales ?? []).filter(Boolean);
    if (locales.length) {
      const task = await client.index(uid).updateSettings({
        localizedAttributes: [{ attributePatterns: ["*"], locales }],
      });
      taskUid = task.taskUid;
    }
    return Response.json({ uid, taskUid }, { status: 201 });
  });
}
