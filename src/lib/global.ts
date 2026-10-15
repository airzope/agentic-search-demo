/**
 * Process-wide singletons. Route bundles and dev-mode HMR can evaluate a
 * module more than once, so long-lived state (models, jobs, watchers) lives
 * on `globalThis`.
 */
const store = globalThis as typeof globalThis & {
  __cjkStudio?: Map<string, unknown>;
};

export function singleton<T>(key: string, create: () => T): T {
  store.__cjkStudio ??= new Map();
  if (!store.__cjkStudio.has(key)) store.__cjkStudio.set(key, create());
  return store.__cjkStudio.get(key) as T;
}
