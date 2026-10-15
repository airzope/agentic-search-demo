/**
 * Numbered citations in answers: [3], [2][5], [2, 5], 【3】. Matching skips
 * code spans and fenced blocks, and leaves Markdown links `[1](url)` alone.
 */
const CITATION =
  /\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\](?!\()|【(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)】/g;

const numbersIn = (group: string) =>
  group
    .split(/\s*[,，、]\s*/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

/** Apply `fn` to the prose parts of Markdown, keeping code untouched. */
function mapProse(markdown: string, fn: (text: string) => string) {
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((segment, index) => (index % 2 === 1 ? segment : fn(segment)))
    .join("");
}

/** Turn citations of known sources into `[n](#cite-n)` links. */
export function linkCitations(markdown: string, known: (n: number) => boolean) {
  return mapProse(markdown, (text) =>
    text
      .replace(CITATION, (match, square?: string, corner?: string) => {
        const numbers = [
          ...new Set(numbersIn(square ?? corner ?? "").filter(known)),
        ];
        if (!numbers.length) return match;
        return numbers.map((n) => `[${n}](#cite-${n})`).join("");
      })
      // [2][2] written by the model shows as one chip.
      .replace(/(\[(\d+)\]\(#cite-\2\))(?:\[\2\]\(#cite-\2\))+/g, "$1"),
  );
}

/** Cited source numbers, in order of first appearance. */
export function citedNumbers(markdown: string, known: (n: number) => boolean) {
  const found: number[] = [];
  mapProse(markdown, (text) => {
    for (const match of text.matchAll(CITATION)) {
      for (const n of numbersIn(match[1] ?? match[2] ?? "")) {
        if (known(n) && !found.includes(n)) found.push(n);
      }
    }
    return text;
  });
  return found;
}
