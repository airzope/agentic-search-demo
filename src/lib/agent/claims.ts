/**
 * Claim extraction and deterministic checks for answer verification. Shared
 * by the verify API and tests; no server-only imports.
 */

const CITATION =
  /\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\](?!\()|【(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)】/g;
const LEADING_CITATIONS =
  /^\s*((?:\[\d{1,3}(?:\s*[,，、]\s*\d{1,3})*\](?!\()|【\d{1,3}(?:\s*[,，、]\s*\d{1,3})*】)+)/;

const citationNumbers = (text: string) => {
  const found: number[] = [];
  for (const match of text.matchAll(CITATION)) {
    for (const part of (match[1] ?? match[2] ?? "").split(/\s*[,，、]\s*/)) {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0 && !found.includes(n)) found.push(n);
    }
  }
  return found;
};

export const stripCitations = (text: string) =>
  text
    .replace(CITATION, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Markdown inline syntax → plain text. */
const plain = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?!#cite-)[^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

/** Enough content to be a claim (not just punctuation or a label). */
const substantive = (text: string) =>
  stripCitations(text).replace(/[\s\p{P}\p{S}]/gu, "").length >= 4;

export type Claim = { text: string; cited: number[] };

/**
 * Split an answer into checkable claims: sentences of paragraphs and list
 * items, and table rows. Citations written after the sentence end
 * ("…申请。[3]") are attached to the sentence they follow.
 */
export function splitClaims(markdown: string): Claim[] {
  const lines = markdown.replace(/```[\s\S]*?(?:```|$)/g, "\n").split("\n");
  const claims: Claim[] = [];
  const push = (raw: string) => {
    const text = plain(raw);
    if (!text) return;
    const leading = text.match(LEADING_CITATIONS);
    if (leading && claims.length) {
      const previous = claims[claims.length - 1];
      for (const n of citationNumbers(leading[1])) {
        if (!previous.cited.includes(n)) previous.cited.push(n);
      }
      previous.text = `${previous.text}${leading[1].trim()}`;
    }
    const rest = leading ? text.slice(leading[0].length) : text;
    if (!substantive(rest)) return;
    claims.push({ text: rest.trim(), cited: citationNumbers(rest) });
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      /^#{1,6}\s/.test(trimmed) ||
      /^([-*_]\s*){3,}$/.test(trimmed)
    ) {
      return;
    }
    if (/^\|?\s*:?-{2,}/.test(trimmed)) return; // table separator
    if (trimmed.startsWith("|")) {
      const next = lines[index + 1]?.trim() ?? "";
      if (/^\|?\s*:?-{2,}/.test(next)) return; // header row
      const cells = trimmed
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
      push(cells.join(" · "));
      return;
    }
    const body = trimmed
      .replace(/^>\s*/, "")
      .replace(/^(?:[-*+]|\d{1,3}[.)、])\s+/, "");
    // Sentence ends: CJK punctuation, or . ! ? followed by a space.
    for (const sentence of body.split(
      /(?<=[。！？；])|(?<=[.!?;])\s+(?=\S)/u,
    )) {
      push(sentence);
    }
  });
  return claims;
}

/* -------------------------------------------------------------- numbers */

const UNIT: Record<string, number> = {
  万: 1e4,
  亿: 1e8,
  千: 1e3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  m: 1e6,
};

/** A stated quantity: candidate values with the rounding each allows. */
export type ClaimNumber = { text: string; values: [number, number][] };

/**
 * Quantities stated in a claim, with the values they may stand for
 * (610.5 万 → 6105000, 42% → 42 or 0.42). Identifiers and dates such as
 * PO-2026-0033 or 2026-03-12 are skipped.
 */
export function claimNumbers(text: string): ClaimNumber[] {
  const source = stripCitations(text);
  const out: ClaimNumber[] = [];
  const pattern =
    /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|％|万|亿|千|[kKmM](?![A-Za-z]))?/g;
  for (const match of source.matchAll(pattern)) {
    const at = match.index ?? 0;
    const before = source[at - 1] ?? "";
    const after = source[at + match[0].length] ?? "";
    if (/[A-Za-z_\-/.:#]/.test(before) || /[A-Za-z_\-/:]/.test(after)) continue;
    if (/^\d{4}$/.test(match[1]) && /年/.test(after)) continue; // a year
    const value = Number(`${match[1].replace(/,/g, "")}${match[2] ?? ""}`);
    if (!Number.isFinite(value)) continue;
    // Half a unit of the last stated digit: "3.2" covers 3.15 – 3.25.
    const step = 0.5 * 10 ** -((match[2]?.length ?? 1) - 1);
    const unit = match[3];
    const values: [number, number][] =
      unit === "%" || unit === "％"
        ? [
            [value, step],
            [value / 100, step / 100],
          ]
        : unit && UNIT[unit]
          ? [
              [value * UNIT[unit], step * UNIT[unit]],
              [value, step],
            ]
          : [[value, step]];
    out.push({ text: match[0].trim(), values });
  }
  return out;
}

/** Every number in evidence text (ids and dates split into their parts). */
export function evidenceNumbers(text: string) {
  const numbers = new Set<number>();
  for (const match of text
    .replace(/(\d),(?=\d{3})/g, "$1")
    .matchAll(/\d+(?:\.\d+)?/g)) {
    numbers.add(Number(match[0]));
  }
  return [...numbers];
}

/** Equal up to rounding: the claim's own precision, or 0.5% relative. */
export function numberFound(claim: ClaimNumber, evidence: number[]) {
  return claim.values.some(([value, step]) =>
    evidence.some((candidate) => {
      if (candidate === value) return true;
      const tolerance = Math.max(step, Math.abs(candidate) * 0.005, 1e-9);
      return Math.abs(candidate - value) <= tolerance;
    }),
  );
}
