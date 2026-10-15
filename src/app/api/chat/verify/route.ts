import type { ChatMessage } from "@/lib/agent/types";
import { verifyAnswer } from "@/lib/agent/verify";
import { LlmConfigError, getProvider } from "@/lib/llm";
import { handle } from "@/lib/meili";

export const maxDuration = 300;

type VerifyBody = {
  messages: ChatMessage[];
  /** The assistant message to verify. */
  messageId: string;
  provider?: string;
  model?: string;
};

/**
 * Check an answer claim by claim against the sources it cites. Without a
 * usable model, only the deterministic checks run.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as VerifyBody;
    let provider = null;
    try {
      provider = await getProvider(body.provider);
    } catch (error) {
      if (!(error instanceof LlmConfigError)) throw error;
    }
    const verification = await verifyAnswer({
      messages: body.messages ?? [],
      messageId: body.messageId,
      provider,
      modelId: body.model?.trim() || provider?.model || "",
      signal: request.signal,
    });
    return Response.json(verification);
  });
}
