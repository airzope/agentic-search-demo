import { badRequest, handle } from "@/lib/meili";
import {
  MAX_PREVIEW_CHARS,
  previewTokens,
  type TokenizerSettings,
} from "@/lib/tokenize";

type TokenizeBody = TokenizerSettings & {
  text?: string;
  /** Meilisearch locale such as "cmn", or null for auto-detection. */
  locale?: string | null;
};

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as TokenizeBody;
    const text = body.text ?? "";
    if (!text.trim()) return badRequest("Text is empty");
    if (text.length > MAX_PREVIEW_CHARS) {
      return badRequest(`Text is limited to ${MAX_PREVIEW_CHARS} characters`);
    }
    const started = Date.now();
    const result = await previewTokens(
      text,
      {
        dictionary: stringList(body.dictionary),
        separatorTokens: stringList(body.separatorTokens),
        nonSeparatorTokens: stringList(body.nonSeparatorTokens),
        stopWords: stringList(body.stopWords),
      },
      body.locale || null,
    );
    return Response.json({ ...result, tookMs: Date.now() - started });
  });
}
