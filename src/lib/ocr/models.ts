import "server-only";

import { open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { downloadFile, fetchText, fileSize } from "@/lib/download";
import type { OcrModelId, OcrSource } from "@/lib/ocr/catalog";
import { OCR_MODELS } from "@/lib/ocr/catalog";
import { dataDir } from "@/lib/settings";

/** Model files land in `.data/models/ocr/<model>/`. */
export const ocrModelDir = (model: OcrModelId) =>
  path.join(dataDir(), "models", "ocr", model);

export type InstalledModel = {
  model: OcrModelId;
  source: string;
  detection: string;
  recognition: string;
  dictionary: string;
  installedAt: string;
};

const MANIFEST = "model.json";

export async function installedModel(
  model: OcrModelId,
): Promise<InstalledModel | null> {
  try {
    const dir = ocrModelDir(model);
    const manifest = JSON.parse(
      await readFile(path.join(dir, MANIFEST), "utf8"),
    ) as InstalledModel;
    for (const file of [
      manifest.detection,
      manifest.recognition,
      manifest.dictionary,
    ]) {
      if ((await fileSize(path.join(dir, file))) === null) return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ hosts */

const PPU_PATHS: Record<
  OcrModelId,
  { detection: string; recognition: string; dictionary: string }
> = {
  small: {
    detection: "detection/ort/PP-OCRv6_small_det.ort",
    recognition: "recognition/ort/PP-OCRv6_small_rec.ort",
    dictionary: "recognition/ppocrv6_dict.txt",
  },
  medium: {
    detection: "detection/ort/PP-OCRv6_medium_det.ort",
    recognition: "recognition/ort/PP-OCRv6_medium_rec.ort",
    dictionary: "recognition/ppocrv6_dict.txt",
  },
  tiny: {
    detection: "detection/ort/PP-OCRv6_tiny_det.ort",
    recognition: "recognition/ort/PP-OCRv6_tiny_rec.ort",
    dictionary: "recognition/ppocrv6_tiny_dict.txt",
  },
  korean: {
    detection: "detection/PP-OCRv5_mobile_det_infer.onnx",
    recognition:
      "recognition/multi/korean/v5/korean_PP-OCRv5_mobile_rec_infer.onnx",
    dictionary: "recognition/multi/korean/v5/ppocrv5_korean_dict.txt",
  },
};

/** RapidOCR's ONNX conversions on ModelScope; the dictionary is in the model metadata. */
const MODELSCOPE_BASE =
  "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx";
const MODELSCOPE_PATHS: Record<
  OcrModelId,
  { detection: string; recognition: string }
> = {
  small: {
    detection: "PP-OCRv6/det/PP-OCRv6_det_small.onnx",
    recognition: "PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
  },
  medium: {
    detection: "PP-OCRv6/det/PP-OCRv6_det_medium.onnx",
    recognition: "PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx",
  },
  tiny: {
    detection: "PP-OCRv6/det/PP-OCRv6_det_tiny.onnx",
    recognition: "PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx",
  },
  korean: {
    detection: "PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx",
    recognition: "PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx",
  },
};

const HOSTS = {
  huggingface:
    "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main",
  "hf-mirror":
    "https://hf-mirror.com/snowfluke/ppu-paddle-ocr-models/resolve/main",
} as const;

/** The rapidocr wheel bundles the PP-OCRv6 small models; PyPI mirrors work too. */
const PYPI_WHEEL = "rapidocr-3.10.0-py3-none-any.whl";
const PYPI_MEMBERS = {
  detection: "rapidocr/models/PP-OCRv6_det_small.onnx",
  recognition: "rapidocr/models/PP-OCRv6_rec_small.onnx",
};

export type DownloadState = {
  source: string | null;
  file: string | null;
  downloaded: number;
  total: number | null;
};

/* ------------------------------------------------------- ONNX / zip */

function readVarint(buffer: Buffer, position: number): [number, number] {
  let result = 0;
  let multiplier = 1;
  let byte: number;
  do {
    byte = buffer[position++];
    result += (byte & 0x7f) * multiplier;
    multiplier *= 128;
  } while (byte & 0x80);
  return [result, position];
}

/** Walk protobuf fields of one message; length-delimited fields get [start, end]. */
function protobufFields(
  buffer: Buffer,
  start: number,
  end: number,
  visit: (field: number, range: [number, number] | null) => void,
) {
  let position = start;
  while (position < end) {
    let key: number;
    [key, position] = readVarint(buffer, position);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      [, position] = readVarint(buffer, position);
      visit(field, null);
    } else if (wire === 1) position += 8;
    else if (wire === 5) position += 4;
    else if (wire === 2) {
      let length: number;
      [length, position] = readVarint(buffer, position);
      visit(field, [position, position + length]);
      position += length;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

/**
 * Read `ModelProto.metadata_props` (field 14). RapidOCR stores the recognition
 * dictionary there under `character`.
 */
export function onnxMetadata(model: Buffer) {
  const metadata: Record<string, string> = {};
  protobufFields(model, 0, model.length, (field, range) => {
    if (field !== 14 || !range) return;
    let key = "";
    let value = "";
    protobufFields(model, range[0], range[1], (inner, innerRange) => {
      if (!innerRange) return;
      const text = model
        .subarray(innerRange[0], innerRange[1])
        .toString("utf8");
      if (inner === 1) key = text;
      else if (inner === 2) value = text;
    });
    if (key) metadata[key] = value;
  });
  return metadata;
}

/** ppu-paddle-ocr dictionary layout: blank first, one character per line. */
const toPpuDictionary = (characters: string) =>
  `\n${characters.replace(/\r?\n$/, "")}\n`;

/** Extract named members from a zip archive (stored or deflated entries). */
export function unzipMembers(archive: Buffer, names: string[]) {
  const wanted = new Set(names);
  const found = new Map<string, Buffer>();
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a zip archive");
  const entries = archive.readUInt16LE(eocd + 10);
  let position = archive.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index++) {
    if (archive.readUInt32LE(position) !== 0x02014b50) {
      throw new Error("Corrupt zip central directory");
    }
    const method = archive.readUInt16LE(position + 10);
    const compressedSize = archive.readUInt32LE(position + 20);
    const nameLength = archive.readUInt16LE(position + 28);
    const extraLength = archive.readUInt16LE(position + 30);
    const commentLength = archive.readUInt16LE(position + 32);
    const localOffset = archive.readUInt32LE(position + 42);
    const name = archive
      .subarray(position + 46, position + 46 + nameLength)
      .toString("utf8");
    position += 46 + nameLength + extraLength + commentLength;
    if (!wanted.has(name)) continue;
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) found.set(name, Buffer.from(data));
    else if (method === 8) found.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip compression method ${method}`);
  }
  return found;
}

/* ---------------------------------------------------------- install */

async function validateModelFile(file: string) {
  const size = (await fileSize(file)) ?? 0;
  const head = Buffer.alloc(16);
  const handle = await open(file, "r");
  await handle.read(head, 0, 16, 0);
  await handle.close();
  // An HTML error page or a Git LFS pointer is small and starts with text.
  const text = head.toString("latin1");
  if (size < 100_000 || /^(<!|<html|version https)/i.test(text)) {
    throw new Error(
      "The downloaded file is not a model (error page or LFS pointer)",
    );
  }
}

async function finish(
  model: OcrModelId,
  source: string,
  files: { detection: string; recognition: string; dictionary: string },
) {
  const manifest: InstalledModel = {
    model,
    source,
    ...files,
    installedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(ocrModelDir(model), MANIFEST),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

async function dictionaryFromModel(dir: string, recognition: string) {
  const metadata = onnxMetadata(await readFile(path.join(dir, recognition)));
  if (!metadata.character) {
    throw new Error("The recognition model carries no character dictionary");
  }
  await writeFile(
    path.join(dir, "dict.txt"),
    toPpuDictionary(metadata.character),
  );
  return "dict.txt";
}

async function fromPpuHost(
  model: OcrModelId,
  base: string,
  progress: DownloadState,
  signal?: AbortSignal,
) {
  const dir = ocrModelDir(model);
  const paths = PPU_PATHS[model];
  const root = base.replace(/\/+$/, "");
  const files = {
    detection: `det${path.extname(paths.detection)}`,
    recognition: `rec${path.extname(paths.recognition)}`,
    dictionary: "dict.txt",
  };
  for (const key of ["detection", "recognition"] as const) {
    progress.file = files[key];
    await downloadFile(`${root}/${paths[key]}`, path.join(dir, files[key]), {
      signal,
      validate: validateModelFile,
      onProgress: (downloaded, total) => {
        progress.downloaded = downloaded;
        progress.total = total;
      },
    });
  }
  progress.file = files.dictionary;
  const dictionary = await fetchText(`${root}/${paths.dictionary}`, signal);
  if (dictionary.split("\n").length < 50) {
    throw new Error("The downloaded dictionary looks invalid");
  }
  await writeFile(path.join(dir, files.dictionary), dictionary);
  return files;
}

async function fromModelScope(
  model: OcrModelId,
  progress: DownloadState,
  signal?: AbortSignal,
) {
  const dir = ocrModelDir(model);
  const paths = MODELSCOPE_PATHS[model];
  for (const [key, name] of [
    ["detection", "det.onnx"],
    ["recognition", "rec.onnx"],
  ] as const) {
    progress.file = name;
    await downloadFile(
      `${MODELSCOPE_BASE}/${paths[key]}`,
      path.join(dir, name),
      {
        signal,
        validate: validateModelFile,
        onProgress: (downloaded, total) => {
          progress.downloaded = downloaded;
          progress.total = total;
        },
      },
    );
  }
  return {
    detection: "det.onnx",
    recognition: "rec.onnx",
    dictionary: await dictionaryFromModel(dir, "rec.onnx"),
  };
}

async function fromPypi(
  model: OcrModelId,
  index: string,
  progress: DownloadState,
  signal?: AbortSignal,
) {
  if (model !== "small") {
    throw new Error("PyPI only carries the PP-OCRv6 small model");
  }
  const dir = ocrModelDir(model);
  const root = index.replace(/\/+$/, "");
  const listing = `${root}/rapidocr/`;
  const html = await fetchText(listing, signal);
  const href = new RegExp(
    `href="([^"]*${PYPI_WHEEL.replaceAll(".", "\\.")}[^"]*)"`,
  ).exec(html)?.[1];
  if (!href) throw new Error(`${PYPI_WHEEL} not found at ${listing}`);
  const wheelUrl = new URL(href.replaceAll("&amp;", "&"), listing).toString();
  const wheel = path.join(dir, PYPI_WHEEL);
  progress.file = PYPI_WHEEL;
  await downloadFile(wheelUrl, wheel, {
    signal,
    onProgress: (downloaded, total) => {
      progress.downloaded = downloaded;
      progress.total = total;
    },
  });
  try {
    const members = unzipMembers(await readFile(wheel), [
      PYPI_MEMBERS.detection,
      PYPI_MEMBERS.recognition,
    ]);
    const detection = members.get(PYPI_MEMBERS.detection);
    const recognition = members.get(PYPI_MEMBERS.recognition);
    if (!detection || !recognition) {
      throw new Error("The wheel does not contain the expected OCR models");
    }
    await writeFile(path.join(dir, "det.onnx"), detection);
    await writeFile(path.join(dir, "rec.onnx"), recognition);
  } finally {
    await rm(wheel, { force: true });
  }
  return {
    detection: "det.onnx",
    recognition: "rec.onnx",
    dictionary: await dictionaryFromModel(dir, "rec.onnx"),
  };
}

/**
 * Download `model` from `source` (or each candidate host in turn for `auto`).
 * Errors from every attempted host are reported together.
 */
export async function installModel(
  model: OcrModelId,
  source: OcrSource,
  options: { baseUrl?: string; pypiIndex?: string; signal?: AbortSignal },
  progress: DownloadState,
) {
  const available = OCR_MODELS.find((item) => item.id === model)?.sources ?? [];
  const candidates =
    source === "auto"
      ? available.filter((item) => item !== "custom")
      : [source as Exclude<OcrSource, "auto">];
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (!available.includes(candidate)) {
      errors.push(`${candidate}: this host does not carry the ${model} model`);
      continue;
    }
    progress.source = candidate;
    progress.downloaded = 0;
    progress.total = null;
    // Start from a clean directory so files from different hosts never mix.
    await rm(ocrModelDir(model), { recursive: true, force: true });
    try {
      let files;
      if (candidate === "modelscope") {
        files = await fromModelScope(model, progress, options.signal);
      } else if (candidate === "pypi") {
        files = await fromPypi(
          model,
          options.pypiIndex || "https://pypi.org/simple",
          progress,
          options.signal,
        );
      } else {
        const base =
          candidate === "custom" ? (options.baseUrl ?? "") : HOSTS[candidate];
        if (!base) throw new Error("Custom model URL is empty");
        files = await fromPpuHost(model, base, progress, options.signal);
      }
      return await finish(model, candidate, files);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      errors.push(
        `${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`Could not download the OCR model. ${errors.join("; ")}`);
}

/** Models present on disk, for the settings page. */
export async function listInstalledModels() {
  try {
    const entries = await readdir(path.join(dataDir(), "models", "ocr"));
    const installed: InstalledModel[] = [];
    for (const entry of entries) {
      const manifest = await installedModel(entry as OcrModelId);
      if (manifest) installed.push(manifest);
    }
    return installed;
  } catch {
    return [];
  }
}
