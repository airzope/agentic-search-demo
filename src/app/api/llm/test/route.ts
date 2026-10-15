import { createPiModel } from "@/lib/agent/model";
import { LlmConfigError, getProvider } from "@/lib/llm";
import { handle } from "@/lib/meili";

/** Send a tiny prompt through pi-ai to check credentials, base URL and model name. */
export async function POST(request: Request) {
  return handle(async () => {
    const { provider: id, model } = (await request.json()) as {
      provider?: string;
      model?: string;
    };
    const provider = await getProvider(id);
    const modelId = model?.trim() || provider.model;
    if (!modelId)
      throw new LlmConfigError(`${provider.name}: model is missing.`);
    const { model: piModel, models } = await createPiModel(provider, modelId);
    const started = Date.now();
    const reply = await models.completeSimple(
      piModel,
      {
        messages: [
          {
            role: "user",
            content: "Reply with the single word: OK",
            timestamp: Date.now(),
          },
        ],
      },
      { maxTokens: 512, signal: AbortSignal.timeout(60_000) },
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      throw new Error(reply.errorMessage || "The model request failed.");
    }
    const text = reply.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      text: text.slice(0, 200),
      model: reply.responseModel ?? reply.model,
    });
  });
}
