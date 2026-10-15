import "server-only";

import { fieldText } from "@/lib/display";
import { describeKb } from "@/lib/kb/catalog";
import type { KbDocument, TreeNode } from "@/lib/kb/types";
import { BadRequestError, getKbIndex } from "@/lib/meili";

const quote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const DOC_FIELDS = [
  "doc_id",
  "title",
  "path",
  "file_type",
  "chunk_count",
  "mtime",
];

/**
 * One level of the folder tree. Counts come from a facet over the first chunk
 * of every file (`chunk_index = 0`), i.e. they are file counts per subtree.
 */
export async function browseTree(
  kbId: string,
  branch: string | null,
  docLimit = 100,
) {
  const kb = await describeKb(kbId);
  if (!kb.schema.chunked) {
    throw new BadRequestError(
      "This index has no folder structure (not a chunked knowledge base)",
    );
  }
  const { index } = await getKbIndex(kbId);
  const scope = branch ? ` AND branch = ${quote(branch)}` : "";
  const [facets, files] = await Promise.all([
    index.search("", {
      filter: `chunk_index = 0${scope}`,
      facets: ["branch"],
      limit: 0,
    }),
    index.search("", {
      filter: `chunk_index = 0 AND dir = ${quote(branch ?? "")}`,
      attributesToRetrieve: DOC_FIELDS,
      limit: docLimit,
    }),
  ]);
  const distribution = facets.facetDistribution?.branch ?? {};
  const depth = branch ? branch.split("/").length + 1 : 1;
  const children: TreeNode[] = Object.entries(distribution)
    .filter(([value]) => {
      const parts = value.split("/");
      return (
        parts.length === depth && (!branch || value.startsWith(`${branch}/`))
      );
    })
    .map(([value, docs]) => ({
      branch: value,
      name: value.split("/").pop() ?? value,
      docs,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const documents: KbDocument[] = files.hits.map((hit) => ({
    doc_id: fieldText(hit.doc_id),
    title: fieldText(hit.title),
    path: fieldText(hit.path),
    file_type: fieldText(hit.file_type) || undefined,
    chunk_count:
      typeof hit.chunk_count === "number" ? hit.chunk_count : undefined,
    mtime: typeof hit.mtime === "number" ? hit.mtime : undefined,
  }));
  return {
    branch,
    totalDocs: facets.estimatedTotalHits ?? 0,
    children,
    documents,
    moreDocuments: (files.estimatedTotalHits ?? 0) > documents.length,
  };
}

export type DocumentChunk = { index: number; heading: string; content: string };

/**
 * Read a whole document (or a window around one chunk), up to `maxChars`.
 * Plain indexes return the single document's fields as one chunk.
 */
export async function readDocument(
  kbId: string,
  docId: string,
  {
    around = null,
    window = 2,
    maxChars = 8000,
  }: {
    around?: number | null;
    window?: number;
    maxChars?: number;
  } = {},
) {
  const kb = await describeKb(kbId);
  const { index } = await getKbIndex(kbId);

  if (!kb.schema.chunked) {
    const document = await index.getDocument(docId);
    const { title, content } = kb.display;
    const text = Object.entries(document)
      .filter(([key]) => !key.startsWith("_") && key !== title)
      .map(([key, value]) =>
        key === content ? fieldText(value) : `${key}: ${fieldText(value)}`,
      )
      .join("\n");
    return {
      kbId: kb.id,
      kbName: kb.name,
      docId,
      title: title ? fieldText(document[title]) : docId,
      path: null,
      chunkCount: 1,
      chunks: [{ index: 0, heading: "", content: text.slice(0, maxChars) }],
      truncated: text.length > maxChars,
    };
  }

  const range =
    around !== null
      ? ` AND chunk_index >= ${Math.max(0, around - window)} AND chunk_index <= ${around + window}`
      : "";
  const result = await index.getDocuments({
    filter: `doc_id = ${quote(docId)}${range}`,
    fields: [
      "chunk_index",
      "chunk_count",
      "heading",
      "content",
      "title",
      "path",
    ],
    limit: 1000,
  });
  const rows = (result.results as unknown as Record<string, unknown>[]).sort(
    (a, b) => Number(a.chunk_index) - Number(b.chunk_index),
  );
  if (!rows.length) throw new BadRequestError(`Document not found: ${docId}`);

  const chunks: DocumentChunk[] = [];
  let used = 0;
  let truncated = false;
  for (const row of rows) {
    const content = fieldText(row.content);
    if (used + content.length > maxChars && chunks.length) {
      truncated = true;
      break;
    }
    chunks.push({
      index: Number(row.chunk_index),
      heading: fieldText(row.heading),
      content,
    });
    used += content.length;
  }
  return {
    kbId: kb.id,
    kbName: kb.name,
    docId,
    title: fieldText(rows[0].title),
    path: fieldText(rows[0].path),
    chunkCount: Number(rows[0].chunk_count) || rows.length,
    chunks,
    truncated,
  };
}
