import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { titleFromMarkdown } from "@/lib/kb/chunk";
import { extensionOf, kindOf } from "@/lib/kb/formats";
import {
  ocrBytes,
  ocrConfigured,
  ocrFile,
  pagesToMarkdown,
} from "@/lib/kb/ocr";

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

export async function convertFile(
  absolutePath: string,
  relativePath: string,
  options: { ocrImages: boolean; ocrEmbedded: boolean; signal?: AbortSignal },
): Promise<Converted> {
  const kind = kindOf(relativePath);
  const extension = extensionOf(relativePath);
  const fallbackTitle = path.basename(relativePath).replace(/\.[^.]+$/, "");
  const warnings: string[] = [];

  const finish = (markdown: string, source: Converted["source"]): Converted => {
    const text = markdown.trim();
    if (!text) throw new SkipFile("No text content");
    return {
      title: titleFromMarkdown(text) ?? fallbackTitle,
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

  if (kind === "image") {
    if (!options.ocrImages) throw new SkipFile("Image OCR is disabled");
    if (!(await ocrConfigured()))
      throw new SkipFile("PaddleOCR service is not configured");
    return finish(
      pagesToMarkdown(await ocrFile(absolutePath, options.signal)),
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
        // Scanned PDF: OCR the whole file locally instead of a hosted service.
        if (!options.ocrImages || !(await ocrConfigured())) {
          throw new SkipFile(
            "Scanned PDF needs OCR, but PaddleOCR is not configured",
          );
        }
        return finish(
          pagesToMarkdown(await ocrFile(absolutePath, options.signal)),
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
      (await ocrConfigured())
    ) {
      try {
        const document = await toDocument(await readFile(absolutePath));
        const texts: string[] = [];
        for (const asset of document.assets) {
          if (!asset.mediaType.startsWith("image/")) continue;
          if (asset.data.byteLength < EMBEDDED_IMAGE_MIN_BYTES) continue;
          const name = `image${asset.id}.${asset.mediaType.split("/")[1] ?? "png"}`;
          const pages = await ocrBytes(asset.data, name, options.signal);
          const text = pagesToMarkdown(pages);
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
