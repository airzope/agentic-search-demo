import { readFile } from "node:fs/promises";
import path from "node:path";

import { badRequest, handle } from "@/lib/meili";
import {
  ensureOcrInstalled,
  ensureOcrLoaded,
  ocrStatus,
  recognizeImage,
} from "@/lib/ocr/engine";

export async function GET() {
  return handle(async () => Response.json(await ocrStatus()));
}

/**
 * `{ action: "download" }` fetches the configured model in the background,
 * `"load"` loads it, `"test"` recognizes the bundled sample image.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { action } = (await request.json()) as { action?: string };
    if (action === "download") {
      void ensureOcrInstalled({ retry: true }).catch(() => undefined);
      return Response.json(await ocrStatus());
    }
    if (action === "load") {
      void ensureOcrLoaded().catch(() => undefined);
      return Response.json(await ocrStatus());
    }
    if (action === "test") {
      const sample = await readFile(
        path.join(process.cwd(), "public", "ocr-sample.png"),
      );
      const started = Date.now();
      const text = await recognizeImage(sample);
      return Response.json({ ok: true, text, latencyMs: Date.now() - started });
    }
    return badRequest("Unknown action");
  });
}
