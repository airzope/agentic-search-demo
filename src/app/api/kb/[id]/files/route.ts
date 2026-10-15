import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { NextRequest } from "next/server";

import { listFiles, resolveSourceFile, type FileStatus } from "@/lib/kb/files";
import { startSync } from "@/lib/kb/jobs";
import { getKbConfig, managedFilesDir } from "@/lib/kb/registry";
import { badRequest, handle, kbIdParam } from "@/lib/meili";

/** `?dir=&status=ok|failed|skipped&q=&offset=&limit=` — files known to the last sync. */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]/files">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    return Response.json(
      await listFiles(id, {
        dir: params.get("dir") ?? "",
        status: ["ok", "failed", "skipped"].includes(status ?? "")
          ? (status as FileStatus)
          : null,
        q: params.get("q"),
        offset: Number(params.get("offset")) || 0,
        limit: Math.min(Number(params.get("limit")) || 100, 500),
      }),
    );
  });
}

/** Delete uploaded files (managed knowledge bases only), then sync. */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/kb/[id]/files">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const config = await getKbConfig(id);
    if (!config) return badRequest("Unknown knowledge base");
    if (config.source.type !== "managed") {
      return badRequest(
        "This knowledge base mirrors a local directory; exclude files instead.",
      );
    }
    const { paths } = (await request.json()) as { paths?: string[] };
    let removed = 0;
    for (const rel of paths ?? []) {
      const target = resolveSourceFile(config, rel);
      if (!target) continue;
      await rm(target, { force: true });
      removed += 1;
    }
    return Response.json({ removed, job: startSync(id) });
  });
}

/** Safe relative path: no absolute paths, no `..`, no empty segments. */
function safeRelative(value: string) {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part === "."))
    return null;
  return parts.join("/");
}

/**
 * Upload files into a managed knowledge base, then sync. Form fields:
 * `file` (repeated) and optional `path` (same order: relative path incl. folders).
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/kb/[id]/files">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const config = await getKbConfig(id);
    if (!config) return badRequest("Unknown knowledge base");
    if (config.source.type !== "managed") {
      return badRequest(
        "This knowledge base mirrors a local directory; add files to that folder.",
      );
    }
    const form = await request.formData();
    const files = form
      .getAll("file")
      .filter((item): item is File => item instanceof File);
    const paths = form.getAll("path").map(String);
    const folder = safeRelative(String(form.get("folder") ?? "")) ?? "";
    if (!files.length) return badRequest("No files");

    const root = managedFilesDir(id);
    const saved: string[] = [];
    for (const [at, file] of files.entries()) {
      const rel = safeRelative(paths[at] || file.name);
      if (!rel) continue;
      // User-chosen paths: keep them out of output file tracing.
      const target = path.join(/*turbopackIgnore: true*/ root, folder, rel);
      if (!target.startsWith(root + path.sep)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await file.arrayBuffer()));
      saved.push(path.relative(root, target).split(path.sep).join("/"));
    }
    return Response.json({ saved, job: startSync(id) });
  });
}
