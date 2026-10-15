import {
  currentEmbeddingModel,
  embedDocuments,
  truncate,
} from "@/lib/embedding";
import { badRequest, handle } from "@/lib/meili";

/**
 * OpenAI-compatible `/embeddings` backed by the configured engine (the
 * built-in Qwen3-Embedding by default), so other tools can reuse it.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as {
      input?: string | string[];
      dimensions?: number;
    };
    const input = Array.isArray(body.input)
      ? body.input
      : body.input
        ? [body.input]
        : [];
    if (!input.length || input.some((item) => typeof item !== "string")) {
      return badRequest("`input` must be a string or an array of strings");
    }
    if (input.length > 256) return badRequest("At most 256 inputs per request");
    const vectors = await embedDocuments(input);
    const dimensions = Number(body.dimensions) || undefined;
    return Response.json({
      object: "list",
      model: await currentEmbeddingModel(),
      data: vectors.map((vector, index) => ({
        object: "embedding",
        index,
        embedding: dimensions ? truncate(vector, dimensions) : vector,
      })),
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
  });
}
