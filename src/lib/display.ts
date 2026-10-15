/**
 * Decide which document fields to show as title / body / image / link,
 * so any index can be rendered without per-index configuration.
 */
export type DisplayFields = {
  title?: string;
  content?: string;
  image?: string;
  url?: string;
};

const TITLE = [
  "title",
  "name",
  "标题",
  "名称",
  "タイトル",
  "제목",
  "subject",
  "headline",
  "heading",
  "question",
  "label",
];
const CONTENT = [
  "content",
  "body",
  "text",
  "description",
  "overview",
  "summary",
  "abstract",
  "answer",
  "正文",
  "内容",
  "描述",
  "本文",
  "내용",
];
const IMAGE = [
  "image",
  "image_url",
  "imageurl",
  "thumbnail",
  "cover",
  "poster",
  "picture",
  "img",
];
const URL = ["url", "link", "href", "source_url", "permalink"];

function pick(fields: string[], candidates: string[]) {
  const lower = new Map(fields.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const hit = lower.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

export function inferDisplayFields(
  fields: string[],
  samples: Record<string, unknown>[] = [],
): DisplayFields {
  const stringLength = (field: string) =>
    samples.reduce((total, doc) => {
      const value = doc[field];
      return total + (typeof value === "string" ? value.length : 0);
    }, 0);
  const stringFields = fields.filter((field) => stringLength(field) > 0);

  const title =
    pick(fields, TITLE) ??
    [...stringFields].sort((a, b) => stringLength(a) - stringLength(b))[0];
  const content =
    pick(
      fields.filter((field) => field !== title),
      CONTENT,
    ) ??
    [...stringFields]
      .filter((field) => field !== title)
      .sort((a, b) => stringLength(b) - stringLength(a))[0];

  const looksLikeUrl = (field: string) =>
    samples.some((doc) => {
      const value = doc[field];
      return typeof value === "string" && /^https?:\/\//.test(value);
    });

  const image = pick(fields, IMAGE);
  const url = pick(fields, URL);

  return {
    title,
    content,
    image: image && looksLikeUrl(image) ? image : undefined,
    url: url && looksLikeUrl(url) ? url : undefined,
  };
}

/** Render any field value as short text. */
export function fieldText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(fieldText).join(", ");
  return JSON.stringify(value);
}
