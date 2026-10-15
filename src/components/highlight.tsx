import { guessLang, splitHighlights } from "@/lib/cjk";
import { cn } from "@/lib/utils";

/**
 * Render Meilisearch `_formatted` text: highlight markers become <mark>, and
 * `lang` is guessed from the content so CJK glyphs use the right font.
 */
export function Highlight({
  value,
  className,
  as: Tag = "span",
}: {
  value: string;
  className?: string;
  as?: "span" | "p" | "div";
}) {
  const parts = splitHighlights(value);
  return (
    <Tag lang={guessLang(value)} className={cn("wrap-break-word", className)}>
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : part.text,
      )}
    </Tag>
  );
}
