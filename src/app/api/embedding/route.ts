import {
  builtinStatus,
  ensureBuiltinDownloaded,
  ensureBuiltinLoaded,
} from "@/lib/embedding/builtin";
import {
  currentEmbeddingModel,
  embedDocuments,
  embedQuery,
} from "@/lib/embedding";
import { badRequest, handle } from "@/lib/meili";
import { getEmbeddingConfig } from "@/lib/settings";

export async function GET() {
  return handle(async () => {
    const config = await getEmbeddingConfig();
    return Response.json({
      engine: config.engine,
      model: await currentEmbeddingModel(),
      builtin: await builtinStatus(),
    });
  });
}

/**
 * `{ action: "download" }` starts the model download in the background,
 * `"load"` loads it, `"test"` embeds a sample and reports latency.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { action } = (await request.json()) as { action?: string };
    if (action === "download") {
      void ensureBuiltinDownloaded().catch(() => undefined);
      return Response.json(await builtinStatus());
    }
    if (action === "load") {
      void ensureBuiltinLoaded().catch(() => undefined);
      return Response.json(await builtinStatus());
    }
    if (action === "test") {
      const started = Date.now();
      const [document] = await embedDocuments([
        "南京长江大桥是中国自行设计建造的第一座长江大桥。",
      ]);
      const query = await embedQuery(`长江上的桥 ${Date.now()}`);
      const similarity = document.reduce(
        (sum, value, at) => sum + value * query[at],
        0,
      );
      return Response.json({
        ok: true,
        dimensions: document.length,
        latencyMs: Date.now() - started,
        similarity: Math.round(similarity * 1000) / 1000,
        model: await currentEmbeddingModel(),
      });
    }
    return badRequest("Unknown action");
  });
}
