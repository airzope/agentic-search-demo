import "server-only";

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ActionAuditEntry } from "@/lib/ontology/types";
import { dataDir } from "@/lib/settings";

/** Append-only log of actions applied (or rejected) from this app. */
const auditFile = () => path.join(dataDir(), "ontology-audit.jsonl");

export async function recordAction(entry: ActionAuditEntry) {
  await mkdir(dataDir(), { recursive: true });
  await appendFile(auditFile(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

export async function readAudit(ontology?: string, limit = 100) {
  let text = "";
  try {
    text = await readFile(auditFile(), "utf8");
  } catch {
    return [];
  }
  const entries: ActionAuditEntry[] = [];
  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ActionAuditEntry;
      if (!ontology || entry.ontology === ontology) entries.push(entry);
    } catch {
      // skip a damaged line
    }
    if (entries.length >= limit) break;
  }
  return entries;
}
