import "server-only";

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function fileSize(file: string) {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

export type DownloadProgress = (
  downloaded: number,
  total: number | null,
) => void;

/**
 * Download `url` to `target`, resuming a previous `.part` file when the server
 * supports ranges. `validate` inspects the finished file before it is moved
 * into place; throwing there discards it.
 */
export async function downloadFile(
  url: string,
  target: string,
  {
    onProgress,
    validate,
    signal,
  }: {
    onProgress?: DownloadProgress;
    validate?: (file: string) => Promise<void>;
    signal?: AbortSignal;
  } = {},
) {
  await mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  let offset = (await fileSize(partial)) ?? 0;

  const response = await fetch(url, {
    headers: offset ? { Range: `bytes=${offset}-` } : {},
    redirect: "follow",
    signal,
  });
  if (response.status === 416) {
    // The partial file is already complete.
  } else if (!response.ok || !response.body) {
    throw new Error(
      `Download failed (${response.status} ${response.statusText}) from ${url}`,
    );
  } else {
    if (offset && response.status !== 206) offset = 0; // range ignored
    const length = Number(response.headers.get("content-length")) || null;
    const total = length !== null ? length + offset : null;
    let downloaded = offset;
    onProgress?.(downloaded, total);
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        downloaded += chunk.byteLength;
        onProgress?.(downloaded, total);
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(counter) as never),
      createWriteStream(partial, { flags: offset ? "a" : "w" }),
    );
  }

  try {
    await validate?.(partial);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, target);
}

/** Fetch a small resource (index page, dictionary) as text. */
export async function fetchText(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: signal ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.text();
}
