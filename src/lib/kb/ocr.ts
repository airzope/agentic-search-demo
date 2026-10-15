import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { singleton } from "@/lib/global";
import { getOcrConfig } from "@/lib/settings";

/**
 * Client for the PaddleOCR sidecar (services/ocr). Requests are queued so a
 * large sync never floods the OCR service.
 */
export type OcrPage = { page: number; text: string };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".pdf": "application/pdf",
};

const queue = singleton("ocr-queue", () => ({
  chain: Promise.resolve() as Promise<unknown>,
}));

export async function ocrConfigured() {
  return Boolean((await getOcrConfig()).url);
}

export async function ocrBytes(
  bytes: Uint8Array,
  filename: string,
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  const { url, lang } = await getOcrConfig();
  if (!url)
    throw new Error("PaddleOCR service is not configured (Settings → OCR).");
  const run = queue.chain.then(async () => {
    const form = new FormData();
    const type =
      MIME[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
    form.set("file", new Blob([Uint8Array.from(bytes)], { type }), filename);
    form.set("lang", lang);
    const response = await fetch(`${url}/ocr`, {
      method: "POST",
      body: form,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)])
        : AbortSignal.timeout(10 * 60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OCR service ${response.status}: ${text.slice(0, 300)}`);
    }
    const body = JSON.parse(text) as { pages?: OcrPage[] };
    return body.pages ?? [];
  });
  queue.chain = run.catch(() => undefined);
  return run;
}

export async function ocrFile(file: string, signal?: AbortSignal) {
  return ocrBytes(await readFile(file), path.basename(file), signal);
}

export async function ocrHealth() {
  const { url } = await getOcrConfig();
  if (!url) return { ok: false, error: "not configured" } as const;
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    return response.ok
      ? ({ ok: true, info: body } as const)
      : ({ ok: false, error: `HTTP ${response.status}` } as const);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } as const;
  }
}

/** OCR pages → Markdown with one heading per page for multi-page input. */
export function pagesToMarkdown(pages: OcrPage[]) {
  const withText = pages.filter((page) => page.text.trim());
  if (withText.length <= 1) return withText[0]?.text.trim() ?? "";
  return withText
    .map((page) => `## 第 ${page.page} 页\n\n${page.text.trim()}`)
    .join("\n\n");
}
