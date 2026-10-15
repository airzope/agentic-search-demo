/** Display helpers shared by pages. */

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1024 ** 3
        ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
        : `${(bytes / 1024 ** 3).toFixed(2)} GB`;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 分钟前" / "3 minutes ago". */
export function formatRelative(value: string | number | Date, lang: string) {
  const time = new Date(value).getTime();
  const seconds = Math.round((time - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    numeric: "auto",
  });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return "";
}

export function formatDuration(ms: number, lang: string) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return lang === "zh" ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return lang === "zh" ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`;
}
