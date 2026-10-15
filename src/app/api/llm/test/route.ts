import { generateText } from "ai";

import { createModel, getProvider } from "@/lib/llm";
import { handle } from "@/lib/meili";

/** Send a tiny prompt to check credentials, base URL and model name. */
export async function POST(request: Request) {
  return handle(async () => {
    const { provider: id, model } = (await request.json()) as {
      provider?: string;
      model?: string;
    };
    const provider = await getProvider(id);
    const started = Date.now();
    const result = await generateText({
      model: createModel(provider, model),
      prompt: "Reply with the single word: OK",
      maxOutputTokens: 512,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
    });
    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      text: result.text.slice(0, 200),
      model: result.response.modelId,
    });
  });
}
