import "server-only";

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { PaddleOcrResult, PaddleOcrService } from "ppu-paddle-ocr";

import { singleton } from "@/lib/global";
import type { OcrModelId } from "@/lib/ocr/catalog";
import {
  installModel,
  installedModel,
  ocrModelDir,
  type DownloadState,
  type InstalledModel,
} from "@/lib/ocr/models";
import { getOcrConfig } from "@/lib/settings";

/**
 * PaddleOCR running in-process on ONNX Runtime (ppu-paddle-ocr). Models are
 * downloaded on first use into `.data/models/ocr/`; recognition calls are
 * serialized so a large sync never runs several OCR inferences at once.
 */
export type OcrPage = { page: number; text: string };

export type OcrState =
  | "disabled"
  | "missing"
  | "downloading"
  | "downloaded"
  | "loading"
  | "ready"
  | "error";

type Runtime = {
  state: "downloading" | "loading" | "ready" | "error" | null;
  error: string | null;
  progress: DownloadState;
  service: PaddleOcrService | null;
  model: OcrModelId | null;
  installing: Promise<InstalledModel> | null;
  /** Last failed download, so a big sync does not retry every host per file. */
  failure: { at: number; model: OcrModelId; error: Error } | null;
  loading: Promise<PaddleOcrService> | null;
  queue: Promise<unknown>;
};

const runtime = singleton<Runtime>("ocr-engine", () => ({
  state: null,
  error: null,
  progress: { source: null, file: null, downloaded: 0, total: null },
  service: null,
  model: null,
  installing: null,
  failure: null,
  loading: null,
  queue: Promise.resolve(),
}));

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function ocrStatus() {
  const config = await getOcrConfig();
  const installed = await installedModel(config.model);
  let state: OcrState;
  if (!config.enabled) state = "disabled";
  else if (runtime.state === "downloading" || runtime.state === "loading") {
    state = runtime.state;
  } else if (runtime.service && runtime.model === config.model) state = "ready";
  else if (runtime.state === "error") state = "error";
  else state = installed ? "downloaded" : "missing";
  return {
    ...config,
    state,
    installed,
    progress: runtime.progress,
    error: runtime.error,
  };
}

export async function ocrEnabled() {
  return (await getOcrConfig()).enabled;
}

const RETRY_AFTER_MS = 5 * 60_000;

/**
 * Download the configured model if it is not on disk yet. After a failure,
 * automatic callers get the same error for a few minutes; `retry` (the
 * Settings button) always tries again.
 */
export async function ensureOcrInstalled({ retry = false } = {}) {
  const config = await getOcrConfig();
  const existing = await installedModel(config.model);
  if (existing) return existing;
  const failure = runtime.failure;
  if (
    !retry &&
    !runtime.installing &&
    failure?.model === config.model &&
    Date.now() - failure.at < RETRY_AFTER_MS
  ) {
    throw failure.error;
  }
  if (!runtime.installing) {
    runtime.state = "downloading";
    runtime.error = null;
    runtime.progress = { source: null, file: null, downloaded: 0, total: null };
    runtime.installing = installModel(
      config.model,
      config.source,
      { baseUrl: config.baseUrl, pypiIndex: config.pypiIndex },
      runtime.progress,
    )
      .then(
        (manifest) => {
          runtime.state = null;
          runtime.failure = null;
          return manifest;
        },
        (error: unknown) => {
          runtime.state = "error";
          runtime.error = message(error);
          runtime.failure = {
            at: Date.now(),
            model: config.model,
            error: error instanceof Error ? error : new Error(message(error)),
          };
          throw error;
        },
      )
      .finally(() => {
        runtime.installing = null;
      });
  }
  return runtime.installing;
}

/** Download (if needed) and load the configured model; reloads after a model switch. */
export async function ensureOcrLoaded(): Promise<PaddleOcrService> {
  const config = await getOcrConfig();
  if (runtime.service && runtime.model === config.model) return runtime.service;
  if (!runtime.loading) {
    runtime.loading = (async () => {
      const manifest = await ensureOcrInstalled();
      runtime.state = "loading";
      runtime.error = null;
      const previous = runtime.service;
      runtime.service = null;
      await previous?.destroy().catch(() => undefined);
      const { PaddleOcrService } = await import("ppu-paddle-ocr");
      const dir = ocrModelDir(config.model);
      const service = new PaddleOcrService({
        model: {
          detection: path.join(dir, manifest.detection),
          recognition: path.join(dir, manifest.recognition),
          charactersDictionary: path.join(dir, manifest.dictionary),
        },
      });
      await service.initialize();
      runtime.service = service;
      runtime.model = config.model;
      runtime.state = "ready";
      return service;
    })()
      .catch((error: unknown) => {
        runtime.state = "error";
        runtime.error = message(error);
        throw error;
      })
      .finally(() => {
        runtime.loading = null;
      });
  }
  return runtime.loading;
}

/** Run one OCR inference at a time. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = runtime.queue.then(task);
  runtime.queue = run.catch(() => undefined);
  return run;
}

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/;

/**
 * Turn OCR lines into text: items on a line are joined (no space between CJK
 * characters), and a larger vertical gap starts a new paragraph.
 */
export function linesToText(result: PaddleOcrResult) {
  const lines = result.lines.filter((line) => line.length);
  if (!lines.length) return result.text.trim();
  const heights = lines
    .map((line) => Math.max(...line.map((item) => item.box.height)))
    .sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  let output = "";
  let previousBottom: number | null = null;
  for (const line of lines) {
    const items = [...line].sort((a, b) => a.box.x - b.box.x);
    let text = "";
    for (const item of items) {
      const piece = item.text.trim();
      if (!piece) continue;
      const joinTight =
        !text || CJK.test(text.at(-1) ?? "") || CJK.test(piece[0] ?? "");
      text += joinTight ? piece : ` ${piece}`;
    }
    if (!text) continue;
    const top = Math.min(...items.map((item) => item.box.y));
    const bottom = Math.max(
      ...items.map((item) => item.box.y + item.box.height),
    );
    if (previousBottom !== null) {
      output += top - previousBottom > median * 0.9 ? "\n\n" : "\n";
    }
    output += text;
    previousBottom = bottom;
  }
  return output.trim();
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

/** OCR one encoded image (PNG, JPEG, WebP, BMP, GIF). */
export async function recognizeImage(bytes: Uint8Array) {
  const service = await ensureOcrLoaded();
  return enqueue(async () =>
    linesToText(
      (await service.recognize(toArrayBuffer(bytes), {
        noCache: true,
      })) as PaddleOcrResult,
    ),
  );
}

/* --------------------------------------------------------------- TIFF */

async function tiffPages(bytes: Uint8Array) {
  const UTIF = await import("utif2");
  const { createCanvas } = await import("@napi-rs/canvas");
  const buffer = toArrayBuffer(bytes);
  const pages: Uint8Array[] = [];
  for (const ifd of UTIF.decode(buffer)) {
    UTIF.decodeImage(buffer, ifd);
    if (!ifd.width || !ifd.height) continue;
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = createCanvas(ifd.width, ifd.height);
    const context = canvas.getContext("2d");
    const image = context.createImageData(ifd.width, ifd.height);
    image.data.set(rgba);
    context.putImageData(image, 0, 0);
    pages.push(canvas.toBuffer("image/png"));
  }
  return pages;
}

/** OCR an image file; multi-page TIFFs yield one page per frame. */
export async function ocrImageFile(
  file: string,
  { onProgress }: { onProgress?: (done: number, total: number) => void } = {},
): Promise<OcrPage[]> {
  const bytes = await readFile(file);
  const extension = path.extname(file).toLowerCase();
  const images =
    extension === ".tif" || extension === ".tiff"
      ? await tiffPages(bytes)
      : [bytes];
  const pages: OcrPage[] = [];
  for (const [index, image] of images.entries()) {
    onProgress?.(index, images.length);
    pages.push({ page: index + 1, text: await recognizeImage(image) });
  }
  return pages;
}

/* ---------------------------------------------------------------- PDF */

/**
 * pdf.js needs its CMaps (CJK fonts) and standard fonts from disk. Look the
 * package up from the working directory: bundlers rewrite `require.resolve`.
 */
function pdfAssets() {
  let dir = process.cwd();
  for (;;) {
    const root = path.join(
      /*turbopackIgnore: true*/ dir,
      "node_modules",
      "pdfjs-dist",
    );
    if (existsSync(path.join(/*turbopackIgnore: true*/ root, "cmaps"))) {
      const url = (name: string) =>
        `${pathToFileURL(path.join(/*turbopackIgnore: true*/ root, name)).href}/`;
      return {
        cMapUrl: url("cmaps"),
        standardFontDataUrl: url("standard_fonts"),
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return {};
    dir = parent;
  }
}

/** Longest rendered side in pixels; enough detail for small CJK print. */
const RENDER_TARGET = 2200;

/**
 * Text of every page of a PDF. Pages listed in `ocrPages` (or all pages when
 * null) are rendered and OCR'd; the others use the PDF's own text layer.
 */
export async function ocrPdf(
  file: string,
  ocrPages: number[] | null,
  {
    onProgress,
    signal,
  }: {
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<OcrPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await readFile(file)),
    verbosity: 0,
    ...pdfAssets(),
  });
  try {
    const document = await loadingTask.promise;
    const wanted = new Set(
      ocrPages ?? Array.from({ length: document.numPages }, (_, i) => i + 1),
    );
    const pages: OcrPage[] = [];
    let done = 0;
    for (let number = 1; number <= document.numPages; number++) {
      if (signal?.aborted) throw new Error("Canceled");
      const page = await document.getPage(number);
      try {
        if (!wanted.has(number)) {
          const content = await page.getTextContent();
          const text = content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
            )
            .join("");
          pages.push({ page: number, text });
          continue;
        }
        onProgress?.(done++, wanted.size);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          4,
          Math.max(1, RENDER_TARGET / Math.max(base.width, base.height)),
        );
        const viewport = page.getViewport({ scale });
        const { createCanvas } = await import("@napi-rs/canvas");
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: context as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
        pages.push({
          page: number,
          text: await recognizeImage(canvas.toBuffer("image/png")),
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await loadingTask.destroy();
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
