import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import type { NextRequest } from "next/server";

import { resolveSourceFile } from "@/lib/kb/files";
import { getKbConfig } from "@/lib/kb/registry";
import { badRequest, handle, kbIdParam } from "@/lib/meili";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
};

/** The original file of a knowledge base document (`?path=` relative path). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/kb/[id]/files/raw">,
) {
  return handle(async () => {
    const id = await kbIdParam(context.params);
    const config = await getKbConfig(id);
    if (!config) return badRequest("Unknown knowledge base");
    const rel = request.nextUrl.searchParams.get("path") ?? "";
    const file = resolveSourceFile(config, rel);
    const info = file ? await stat(file).catch(() => null) : null;
    if (!file || !info?.isFile()) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }
    const name = path.basename(file);
    const type = TYPES[path.extname(name).toLowerCase()];
    return new Response(
      Readable.toWeb(createReadStream(file)) as ReadableStream,
      {
        headers: {
          "Content-Type": type ?? "application/octet-stream",
          "Content-Length": String(info.size),
          "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  });
}
