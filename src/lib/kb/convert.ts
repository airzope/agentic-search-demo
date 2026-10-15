import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { titleFromMarkdown } from "@/lib/kb/chunk";
import { extensionOf, kindOf } from "@/lib/kb/formats";
import {
  ocrEnabled,
  ocrImageFile,
  ocrPdf,
  pagesToMarkdown,
  recognizeImage,
} from "@/lib/ocr/engine";

/** A source file turned into Markdown plus provenance. */
export type Converted = {
  title: string;
  markdown: string;
  source: "text" | "anydoc" | "ocr" | "anydoc+ocr";
  warnings: string[];
};

export class SkipFile extends Error {}

/* --------------------------------------------------------------- text */

const LEGACY_ENCODINGS = ["gb18030", "big5", "shift_jis", "euc-kr"];

/**
 * Decode text files, detecting the legacy CJK encodings still common on
 * Windows (GBK/GB18030, Big5, Shift_JIS, EUC-KR) when the bytes are not UTF-8.
 */
export function decodeText(buffer: Buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    let best = { text: buffer.toString("utf8"), bad: Number.POSITIVE_INFINITY };
    for (const encoding of LEGACY_ENCODINGS) {
      const text = new TextDecoder(encoding).decode(buffer);
      const bad = (text.match(/�/g) ?? []).length;
      if (bad < best.bad) best = { text, bad };
    }
    return best.text;
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Minimal HTML → Markdown: headings, paragraphs, list items, line breaks. */
export function htmlToMarkdown(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, level, text) =>
        `\n\n${"#".repeat(Number(level))} ${text.replace(/<[^>]+>/g, "").trim()}\n\n`,
    )
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|tr|li|ul|ol|table|blockquote)>/gi,
      "\n\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#"))
        return String.fromCodePoint(parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------- anydoc */

type AnydocModule = typeof import("@firecrawl/anydoc");
let anydoc: Promise<AnydocModule> | null = null;
const loadAnydoc = () => (anydoc ??= import("@firecrawl/anydoc"));

const EMBEDDED_IMAGE_MIN_BYTES = 8 * 1024;
const OFFICE_WITH_IMAGES = new Set([
  "docx",
  "docm",
  "pptx",
  "pptm",
  "ppsx",
  "odt",
  "odp",
]);

/* ------------------------------------------------------------ convert */

/** Raster formats the OCR engine decodes (plus TIFF, decoded separately). */
const OCR_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

export async function convertFile(
  absolutePath: string,
  relativePath: string,
  options: {
    ocrImages: boolean;
    ocrEmbedded: boolean;
    signal?: AbortSignal;
    /** OCR progress for long scans, e.g. "OCR 3/120". */
    onProgress?: (note: string) => void;
  },
): Promise<Converted> {
  const kind = kindOf(relativePath);
  const extension = extensionOf(relativePath);
  const fallbackTitle = path.basename(relativePath).replace(/\.[^.]+$/, "");
  const warnings: string[] = [];

  const finish = (markdown: string, source: Converted["source"]): Converted => {
    const text = markdown.trim();
    if (!text) throw new SkipFile("No text content");
    return {
      // OCR output carries "## 第 N 页" headings; they are not titles.
      title:
        titleFromMarkdown(text.replace(/^## 第 \d+ 页$/gm, "")) ??
        fallbackTitle,
      markdown: text,
      source,
      warnings,
    };
  };

  if (kind === "text") {
    const text = decodeText(await readFile(absolutePath));
    if (extension === "html" || extension === "htm") {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim();
      const converted = finish(htmlToMarkdown(text), "text");
      return title ? { ...converted, title } : converted;
    }
    return finish(text, "text");
  }

  const progress = (done: number, total: number) =>
    total > 1 && options.onProgress?.(`OCR ${done + 1}/${total}`);

  if (kind === "image") {
    if (!options.ocrImages) throw new SkipFile("Image OCR is disabled");
    if (!(await ocrEnabled()))
      throw new SkipFile("OCR is turned off in Settings");
    return finish(
      pagesToMarkdown(
        await ocrImageFile(absolutePath, { onProgress: progress }),
      ),
      "ocr",
    );
  }

  if (kind === "anydoc") {
    const { toMarkdown, toDocument } = await loadAnydoc();
    let markdown: string;
    try {
      markdown = await toMarkdown(absolutePath);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "needsOcr") {
        // Scanned (or partly scanned) PDF: OCR the listed pages in-process,
        // and use the PDF's own text layer for the rest.
        if (!options.ocrImages || !(await ocrEnabled())) {
          throw new SkipFile("Scanned PDF needs OCR, which is turned off");
        }
        const { pages, pageCount } = error as {
          pages?: number[];
          pageCount?: number;
        };
        const ocrPages =
          pages?.length && pages.length < (pageCount ?? 0) ? pages : null;
        if (ocrPages) {
          warnings.push(
            `OCR on ${ocrPages.length} of ${pageCount} pages (scanned pages)`,
          );
        }
        return finish(
          pagesToMarkdown(
            await ocrPdf(absolutePath, ocrPages, {
              onProgress: progress,
              signal: options.signal,
            }),
          ),
          "ocr",
        );
      }
      if (code === "encrypted")
        throw new SkipFile("Encrypted or password-protected");
      if (code === "unsupported") throw new SkipFile("Unsupported format");
      throw error;
    }

    let source: Converted["source"] = "anydoc";
    if (
      options.ocrEmbedded &&
      OFFICE_WITH_IMAGES.has(extension) &&
      (await ocrEnabled())
    ) {
      try {
        const document = await toDocument(await readFile(absolutePath));
        const texts: string[] = [];
        const images = document.assets.filter(
          (asset) =>
            OCR_IMAGE_TYPES.has(asset.mediaType) &&
            asset.data.byteLength >= EMBEDDED_IMAGE_MIN_BYTES,
        );
        for (const [index, asset] of images.entries()) {
          if (options.signal?.aborted) break;
          progress(index, images.length);
          const text = await recognizeImage(asset.data);
          if (text) texts.push(text);
        }
        if (texts.length) {
          markdown += `\n\n## 图片中的文字\n\n${texts.join("\n\n")}`;
          source = "anydoc+ocr";
        }
      } catch (error) {
        warnings.push(
          `Embedded image OCR failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return finish(markdown, source);
  }

  throw new SkipFile("Unsupported file type");
}
