import "server-only";

import { currentEmbeddingModel } from "@/lib/embedding";
import { singleton } from "@/lib/global";
import { activeJob, latestJob } from "@/lib/kb/jobs";
import { getKbConfig, listKbConfigs } from "@/lib/kb/registry";
import { detectSchema, type IndexSchema } from "@/lib/kb/schema";
import type { ConnectionStatus, KbConfig, KbSummary } from "@/lib/kb/types";
import {
  getKbIndex,
  getMeili,
  isHiddenIndex,
  kbIdOf,
  parseKbId,
} from "@/lib/meili";
import { describeIndex } from "@/lib/search";
import { getConnections } from "@/lib/settings";

/** Everything needed to search or display one knowledge base. */
export type KbDescription = Awaited<ReturnType<typeof describeIndex>> & {
  id: string;
  connectionId: string;
  connectionName: string;
  name: string;
  schema: IndexSchema;
  config: KbConfig | null;
};

const TTL_MS = 30_000;
const cache = singleton(
  "kb-describe-cache",
  () => new Map<string, { at: number; value: Promise<KbDescription> }>(),
);

export function invalidateKb(id?: string) {
  if (id) cache.delete(id);
  else cache.clear();
}

/** Index settings and stats are cached briefly; the registration is always fresh. */
export async function describeKb(
  id: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<KbDescription> {
  let cached = cache.get(id);
  if (fresh || !cached || Date.now() - cached.at >= TTL_MS) {
    const value = (async () => {
      const ref = await getKbIndex(id);
      const [description, connections] = await Promise.all([
        describeIndex(ref.index),
        getConnections(),
      ]);
      const schema = detectSchema(description.settings);
      return {
        ...description,
        id: ref.id,
        connectionId: ref.connectionId,
        connectionName:
          connections.find((connection) => connection.id === ref.connectionId)
            ?.name ?? ref.connectionId,
        name: ref.indexUid,
        schema,
        config: null,
        display: schema.chunked
          ? { title: "title", content: "content" }
          : description.display,
      } satisfies KbDescription;
    })();
    cached = { at: Date.now(), value };
    cache.set(id, cached);
    value.catch(() => cache.delete(id));
  }
  const [description, config] = await Promise.all([
    cached.value,
    getKbConfig(parseKbId(id).id),
  ]);
  return { ...description, config, name: config?.name || description.uid };
}

/** Whether a KB's stored vectors match the current embedding model. */
export async function vectorCompatible(kb: KbDescription) {
  if (!kb.schema.vector) return false;
  const model = kb.config?.embedding.model;
  return !model || model === (await currentEmbeddingModel());
}

/** All knowledge bases on all connections, plus connection health. */
export async function listKnowledgeBases() {
  const [connections, configs] = await Promise.all([
    getConnections(),
    listKbConfigs(),
  ]);
  const statuses: ConnectionStatus[] = [];
  const kbs: KbSummary[] = [];

  await Promise.all(
    connections.map(async (connection) => {
      try {
        const client = await getMeili(connection.id);
        const [{ results }, stats] = await Promise.all([
          client.getRawIndexes({ limit: 1000 }),
          client.getStats(),
        ]);
        statuses.push({
          id: connection.id,
          name: connection.name,
          host: connection.host,
          ok: true,
        });
        const visible = results.filter((index) => !isHiddenIndex(index.uid));
        await Promise.all(
          visible.map(async (index) => {
            const id = kbIdOf(connection.id, index.uid);
            const config = configs.find((item) => item.id === id) ?? null;
            let schema: IndexSchema = {
              chunked: false,
              vector: null,
              embedders: [],
            };
            try {
              schema = detectSchema(
                await client.index(index.uid).getSettings(),
              );
            } catch {
              // keep defaults
            }
            kbs.push({
              id,
              connectionId: connection.id,
              connectionName: connection.name,
              indexUid: index.uid,
              name: config?.name || index.uid,
              description: config?.description ?? "",
              documents: stats.indexes[index.uid]?.numberOfDocuments ?? 0,
              isIndexing: stats.indexes[index.uid]?.isIndexing ?? false,
              chunked: schema.chunked,
              vector: schema.vector,
              embedders: schema.embedders,
              config,
              job: activeJob(id) ?? latestJob(id),
            });
          }),
        );
      } catch (error) {
        statuses.push({
          id: connection.id,
          name: connection.name,
          host: connection.host,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  const order = new Map(
    connections.map((connection, at) => [connection.id, at]),
  );
  kbs.sort(
    (a, b) =>
      (order.get(a.connectionId) ?? 0) - (order.get(b.connectionId) ?? 0) ||
      a.name.localeCompare(b.name),
  );
  statuses.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { kbs, connections: statuses };
}
