/** File types the ingestion pipeline understands. */

export const ANYDOC_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "docm",
  "dot",
  "dotx",
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "csv",
];

export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "bmp",
  "webp",
  "tif",
  "tiff",
];

export const TEXT_EXTENSIONS = [
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "log",
  "rst",
  "adoc",
  "org",
  "tex",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "tsv",
  "html",
  "htm",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "kt",
  "scala",
  "sh",
  "bash",
  "ps1",
  "sql",
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "lua",
  "r",
  "dart",
  "proto",
  "graphql",
];

export const SUPPORTED_EXTENSIONS = [
  ...ANYDOC_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
];

export const DEFAULT_EXCLUDE = [
  "node_modules",
  ".git",
  ".svn",
  "__pycache__",
  ".venv",
  "~$*",
  "*.tmp",
  "Thumbs.db",
  ".DS_Store",
];

export const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export type FileKind = "anydoc" | "image" | "text" | "unsupported";

export function kindOf(path: string): FileKind {
  const extension = extensionOf(path);
  if (ANYDOC_EXTENSIONS.includes(extension)) return "anydoc";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  if (TEXT_EXTENSIONS.includes(extension)) return "text";
  return "unsupported";
}

/** Compile glob-ish exclude patterns into a matcher for relative paths. */
export function compileExcludes(patterns: string[]) {
  const toRegex = (glob: string) =>
    new RegExp(
      "^" +
        glob
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "\u0000")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]")
          .replace(/\u0000/g, ".*") +
        "$",
    );
  const segmentRules = patterns
    .filter((pattern) => pattern && !pattern.includes("/"))
    .map(toRegex);
  const pathRules = patterns
    .filter((pattern) => pattern.includes("/"))
    .map((pattern) => toRegex(pattern.replace(/^\/+/, "")));

  return (relativePath: string) => {
    if (pathRules.some((rule) => rule.test(relativePath))) return true;
    return relativePath
      .split("/")
      .some((segment) => segmentRules.some((rule) => rule.test(segment)));
  };
}
