import { readFile } from "node:fs/promises";
import path from "node:path";

import { getMeili, handle } from "@/lib/meili";
import { getConnections } from "@/lib/settings";
import type { AboutInfo } from "@/lib/types";

/** Main libraries shown under Settings → About. */
const COMPONENTS: [pkg: string, label: string][] = [
  ["next", "Next.js"],
  ["@earendil-works/pi-agent-core", "pi agent"],
  ["@osdk/client", "Palantir OSDK"],
  ["ai", "Vercel AI SDK"],
  ["meilisearch", "Meilisearch JS"],
  ["@firecrawl/anydoc", "anydoc"],
  ["ppu-paddle-ocr", "PaddleOCR (ppu-paddle-ocr)"],
  ["onnxruntime-node", "ONNX Runtime"],
  ["node-llama-cpp", "node-llama-cpp"],
];

async function packageVersion(...parts: string[]) {
  try {
    const file = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      ...parts,
      "package.json",
    );
    const json = JSON.parse(await readFile(file, "utf8")) as {
      version?: string;
    };
    return json.version ?? null;
  } catch {
    return null;
  }
}

/** App, runtime, search engine and library versions. */
export async function GET() {
  return handle(async () => {
    const connections = await getConnections();
    const [version, components, meilisearch] = await Promise.all([
      packageVersion(),
      Promise.all(
        COMPONENTS.map(async ([pkg, name]) => ({
          name,
          version: await packageVersion("node_modules", pkg),
        })),
      ),
      Promise.all(
        connections.map(async (connection) => {
          const base = {
            id: connection.id,
            name: connection.name,
            host: connection.host,
          };
          try {
            const client = await getMeili(connection.id);
            const info = await client.getVersion();
            return { ...base, ok: true, version: info.pkgVersion };
          } catch (error) {
            return {
              ...base,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      ),
    ]);
    return Response.json({
      version,
      runtime: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      meilisearch,
      components,
    } satisfies AboutInfo);
  });
}
