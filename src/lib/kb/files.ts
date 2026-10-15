import "server-only";

import path from "node:path";

import {
  readManifestCached,
  sourceRoot,
  type ManifestEntry,
} from "@/lib/kb/sync";
import type { KbConfig } from "@/lib/kb/types";

export type FileStatus = ManifestEntry["status"];

export type KbFile = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  docId: string;
  chunks: number;
  status: FileStatus;
  message?: string;
};

export type KbFolder = {
  path: string;
  name: string;
  files: number;
  failed: number;
};

export type FileListing = {
  dir: string;
  folders: KbFolder[];
  files: KbFile[];
  total: number;
  counts: Record<FileStatus | "all", number>;
};

/**
 * Browse the files of a knowledge base from its sync manifest, which knows
 * every file including failed and skipped ones (the index only has the
 * converted chunks).
 */
export async function listFiles(
  kbId: string,
  {
    dir = "",
    status,
    q,
    offset = 0,
    limit = 100,
  }: {
    dir?: string;
    status?: FileStatus | null;
    q?: string | null;
    offset?: number;
    limit?: number;
  },
): Promise<FileListing> {
  const manifest = await readManifestCached(kbId);
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const query = q?.trim().toLowerCase() ?? "";
  const counts: FileListing["counts"] = {
    all: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  };
  const folders = new Map<string, KbFolder>();
  const files: KbFile[] = [];

  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (prefix && !rel.startsWith(prefix)) continue;
    counts.all += 1;
    counts[entry.status] += 1;
    const rest = rel.slice(prefix.length);
    const slash = rest.indexOf("/");
    // Without a search or status filter, list one level: sub-folders plus
    // the files directly here. Filtered views are flat and recursive.
    if (!query && !status && slash >= 0) {
      const name = rest.slice(0, slash);
      const folder = folders.get(name) ?? {
        path: prefix + name,
        name,
        files: 0,
        failed: 0,
      };
      folder.files += 1;
      if (entry.status === "failed") folder.failed += 1;
      folders.set(name, folder);
      continue;
    }
    if (status && entry.status !== status) continue;
    if (query && !rel.toLowerCase().includes(query)) continue;
    files.push({
      path: rel,
      name: path.posix.basename(rel),
      size: entry.size,
      mtime: Math.round(entry.mtimeMs),
      docId: entry.docId,
      chunks: entry.chunks,
      status: entry.status,
      ...(entry.message ? { message: entry.message } : {}),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    dir: prefix.replace(/\/$/, ""),
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    files: files.slice(offset, offset + limit),
    total: files.length,
    counts,
  };
}

/** Absolute path of a file inside the knowledge base source, or null if outside. */
export function resolveSourceFile(config: KbConfig, rel: string) {
  const root = path.resolve(sourceRoot(config));
  const target = path.resolve(root, rel);
  return target.startsWith(root + path.sep) ? target : null;
}
