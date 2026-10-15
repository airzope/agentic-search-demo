import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { startSync } from "@/lib/kb/jobs";
import { getKbConfig, managedFilesDir } from "@/lib/kb/registry";
import { badRequest, handle, kbIdParam } from "@/lib/meili";

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
