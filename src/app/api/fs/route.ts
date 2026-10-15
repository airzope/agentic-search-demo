import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

import { badRequest, handle } from "@/lib/meili";

/**
 * List sub-folders of a directory on the machine running the app, to pick a
 * folder to map as a knowledge base. File contents are never read here.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const requested = request.nextUrl.searchParams.get("path") || homedir();
    if (!path.isAbsolute(requested)) return badRequest("Path must be absolute");
    const dir = path.resolve(requested);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) return badRequest(`Not a directory: ${dir}`);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 500);
    const files = entries.filter((entry) => entry.isFile()).length;
    const parent = path.dirname(dir);
    return Response.json({
      path: dir,
      parent: parent === dir ? null : parent,
      dirs,
      files,
      home: homedir(),
    });
  });
}
