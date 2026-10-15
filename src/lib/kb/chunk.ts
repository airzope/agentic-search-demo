/**
 * Markdown-aware chunker for CJK text.
 *
 * Splits by headings first (keeping a "heading path" for context), then packs
 * paragraphs into chunks of about `size` characters. Long paragraphs are cut at
 * sentence ends (。！？；… as well as .!?;), tables keep their header row in
 * every piece, and fenced code blocks stay intact when they fit.
 */

export type Chunk = { heading: string; content: string };

type Section = { heading: string; blocks: string[] };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const SENTENCE_END = /(?<=[。！？；!?;…])\s*|(?<=\.)\s+/u;

function toSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: string[] = [];
  let current: Section = { heading: "", blocks: [] };
  let block: string[] = [];
  let inFence = false;

  const flushBlock = () => {
    const text = block.join("\n").trim();
    if (text) current.blocks.push(text);
    block = [];
  };
  const flushSection = () => {
    flushBlock();
    if (current.blocks.length) sections.push(current);
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      block.push(line);
      if (!inFence) flushBlock();
      continue;
    }
    if (inFence) {
      block.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushSection();
      const level = heading[1].length;
      stack.length = level - 1;
      stack[level - 1] = heading[2].trim();
      const path = stack.filter(Boolean).join(" > ");
      // Keep the heading text in the body so keyword search can match it.
      current = { heading: path, blocks: [heading[2].trim()] };
      continue;
    }
    if (!line.trim()) {
      flushBlock();
      continue;
    }
    // Tables: keep rows of one table in one block.
    block.push(line);
  }
  flushSection();
  return sections;
}

function splitSentences(text: string) {
  return text.split(SENTENCE_END).filter((part) => part.trim());
}

function hardSplit(text: string, size: number) {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    parts.push(text.slice(start, start + size));
  }
  return parts;
}

/** Break one oversized block into pieces of at most `size` characters. */
function splitBlock(block: string, size: number): string[] {
  const lines = block.split("\n");
  const isTable =
    lines.length > 2 && lines.every((line) => line.trim().startsWith("|"));
  if (isTable) {
    const header = lines.slice(0, 2).join("\n");
    const pieces: string[] = [];
    let rows: string[] = [];
    let length = header.length;
    for (const row of lines.slice(2)) {
      if (rows.length && length + row.length + 1 > size) {
        pieces.push([header, ...rows].join("\n"));
        rows = [];
        length = header.length;
      }
      rows.push(row);
      length += row.length + 1;
    }
    if (rows.length) pieces.push([header, ...rows].join("\n"));
    return pieces.flatMap((piece) =>
      piece.length > size * 2 ? hardSplit(piece, size) : [piece],
    );
  }

  const pieces: string[] = [];
  let buffer = "";
  for (const sentence of splitSentences(block)) {
    const units =
      sentence.length > size ? hardSplit(sentence, size) : [sentence];
    for (const unit of units) {
      if (buffer && buffer.length + unit.length > size) {
        pieces.push(buffer);
        buffer = "";
      }
      buffer += unit;
    }
  }
  if (buffer.trim()) pieces.push(buffer);
  return pieces;
}

/** Last ~`overlap` characters of a chunk, starting at a sentence boundary. */
function tail(text: string, overlap: number) {
  if (overlap <= 0 || text.length <= overlap) return "";
  // Never carry half a table row or code line into the next chunk.
  const lastLine = text.trimEnd().split("\n").pop() ?? "";
  if (/^\s*(\||```|~~~)/.test(lastLine)) return "";
  const slice = text.slice(-overlap);
  const sentences = splitSentences(slice);
  return sentences.length > 1 ? sentences.slice(1).join("") : slice;
}

export function chunkMarkdown(
  markdown: string,
  { size = 800, overlap = 100 }: { size?: number; overlap?: number } = {},
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of toSections(markdown)) {
    let buffer = "";
    const emit = () => {
      if (buffer.trim())
        chunks.push({ heading: section.heading, content: buffer.trim() });
    };
    for (const block of section.blocks) {
      const pieces = block.length > size ? splitBlock(block, size) : [block];
      for (const piece of pieces) {
        if (buffer && buffer.length + piece.length + 2 > size) {
          emit();
          const carry = tail(buffer, overlap);
          buffer = carry ? `${carry}\n\n` : "";
        }
        buffer += (buffer && !buffer.endsWith("\n\n") ? "\n\n" : "") + piece;
      }
    }
    emit();
  }
  return chunks;
}

/** First H1 (or any heading) as the document title. */
export function titleFromMarkdown(markdown: string) {
  const match = /^#{1,2}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}
