import "server-only";

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { singleton } from "@/lib/global";
import { dataDir } from "@/lib/settings";
import type { KbConfig } from "@/lib/kb/types";

/** App-side metadata for knowledge bases, stored in `.data/kb.json`. */
type RegistryFile = { version: 1; kbs: Record<string, KbConfig> };

const registryFile = () => path.join(dataDir(), "kb.json");

/** Per-KB working directory: manifest, managed files. */
export const kbDir = (id: string) =>
  path.join(dataDir(), "kb", id.replace(/[^A-Za-z0-9_-]/g, "__"));

export const managedFilesDir = (id: string) => path.join(kbDir(id), "files");

async function read(): Promise<RegistryFile> {
  try {
    const data = JSON.parse(await readFile(registryFile(), "utf8"));
    return { version: 1, kbs: data.kbs ?? {} };
  } catch {
    return { version: 1, kbs: {} };
  }
}

// Serialize read-modify-write cycles.
const lock = singleton("kb-registry-lock", () => ({
  chain: Promise.resolve() as Promise<unknown>,
}));

async function mutate<T>(fn: (data: RegistryFile) => T | Promise<T>) {
  const run = lock.chain.then(async () => {
    const data = await read();
    const result = await fn(data);
    await mkdir(dataDir(), { recursive: true });
    const file = registryFile();
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
    return result;
  });
  lock.chain = run.catch(() => undefined);
  return run;
}

export async function listKbConfigs() {
  return Object.values((await read()).kbs);
}

export async function getKbConfig(id: string) {
  return (await read()).kbs[id] ?? null;
}

export async function saveKbConfig(config: KbConfig) {
  await mutate((data) => {
    data.kbs[config.id] = config;
  });
  return config;
}

export async function removeKbConfig(id: string, { purgeFiles = false } = {}) {
  await mutate((data) => {
    delete data.kbs[id];
  });
  // The manifest describes indexed content; drop it with the registration.
  await rm(path.join(kbDir(id), "manifest.json"), { force: true });
  if (purgeFiles) await rm(kbDir(id), { recursive: true, force: true });
}
