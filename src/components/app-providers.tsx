"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Toaster } from "@/components/ui/toaster";
import { api, readStorage, writeStorage } from "@/lib/client";
import { DICTIONARIES, format, type MessageKey, type UiLang } from "@/lib/i18n";
import type { ConnectionStatus, KbDetail, KbSummary } from "@/lib/kb/types";
import type { SearchPrefs, StatusInfo } from "@/lib/types";

/* ------------------------------------------------------------------ i18n */

type I18n = {
  lang: UiLang;
  setLang: (lang: UiLang) => void;
  t: (
    key: MessageKey,
    vars?: Record<string, string | number | undefined>,
  ) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside AppProviders");
  return context;
}

/* ------------------------------------------------------------- workspace */

const DEFAULT_PREFS: SearchPrefs = {
  mode: "keyword",
  semanticRatio: 0.5,
  embedder: null,
  locales: [],
};

type Workspace = {
  status: StatusInfo | null;
  /** Knowledge bases on every connection; null while loading. */
  kbs: KbSummary[] | null;
  connections: ConnectionStatus[];
  /** The knowledge base managed on the tokenization / embedder pages. */
  kbId: string | null;
  setKbId: (id: string) => void;
  currentKb: KbSummary | null;
  detail: KbDetail | null;
  /** Knowledge bases searched by the search and chat pages. */
  scope: string[];
  setScope: (ids: string[]) => void;
  /** Custom (non-Qwen3) embedders available in the scope. */
  embedders: string[];
  /** Whether hybrid / semantic search is possible for the scope. */
  semanticAvailable: boolean;
  prefs: SearchPrefs;
  setPrefs: (patch: Partial<SearchPrefs>) => void;
  refreshStatus: () => Promise<void>;
  refreshKbs: () => Promise<void>;
  refreshDetail: () => Promise<void>;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context)
    throw new Error("useWorkspace must be used inside AppProviders");
  return context;
}

const KB_KEY = "cjk-studio.kb";
const SCOPE_KEY = "cjk-studio.scope";
const PREFS_KEY = "cjk-studio.prefs";

export const kbPath = (id: string) => `/api/kb/${encodeURIComponent(id)}`;

function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [kbs, setKbs] = useState<KbSummary[] | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [preferredKb, setPreferredKb] = useState<string | null>(null);
  const [preferredScope, setPreferredScope] = useState<string[]>([]);
  const [detail, setDetail] = useState<KbDetail | null>(null);
  const [prefs, setPrefsState] = useState<SearchPrefs>(DEFAULT_PREFS);

  // Restore persisted choices after mount (avoids hydration mismatches).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage
    setPreferredKb(readStorage<string | null>(KB_KEY, null));
    setPreferredScope(readStorage<string[]>(SCOPE_KEY, []));
    setPrefsState({ ...DEFAULT_PREFS, ...readStorage(PREFS_KEY, {}) });
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusInfo>("/api/status"));
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshKbs = useCallback(async () => {
    try {
      const result = await api<{
        kbs: KbSummary[];
        connections: ConnectionStatus[];
      }>("/api/kb");
      setKbs(result.kbs);
      setConnections(result.connections);
    } catch {
      setKbs([]);
    }
  }, []);

  useEffect(() => {
    // Async loaders: state is only set after the requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
    void refreshKbs();
  }, [refreshStatus, refreshKbs]);

  // Keep the list fresh while any knowledge base is syncing or indexing.
  const busy = kbs?.some(
    (kb) =>
      kb.isIndexing ||
      kb.job?.status === "running" ||
      kb.job?.status === "queued",
  );
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refreshKbs(), 2500);
    return () => clearInterval(timer);
  }, [busy, refreshKbs]);

  // The selected KB must exist; fall back to the first one.
  const kbId = useMemo(() => {
    if (!kbs?.length) return null;
    if (preferredKb && kbs.some((kb) => kb.id === preferredKb))
      return preferredKb;
    return kbs[0].id;
  }, [kbs, preferredKb]);

  const setKbId = useCallback((id: string) => {
    setPreferredKb(id);
    writeStorage(KB_KEY, id);
  }, []);

  const scope = useMemo(() => {
    const valid = preferredScope.filter((id) =>
      kbs?.some((kb) => kb.id === id),
    );
    return valid.length ? valid : kbId ? [kbId] : [];
  }, [preferredScope, kbs, kbId]);

  const setScope = useCallback((ids: string[]) => {
    setPreferredScope(ids);
    writeStorage(SCOPE_KEY, ids);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!kbId) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api<KbDetail>(kbPath(kbId)));
    } catch {
      setDetail(null);
    }
  }, [kbId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before loading the new KB
    setDetail((current) => (current?.id === kbId ? current : null));
    void refreshDetail();
  }, [refreshDetail, kbId]);

  const scopeKbs = useMemo(
    () => (kbs ?? []).filter((kb) => scope.includes(kb.id)),
    [kbs, scope],
  );
  const embedders = useMemo(
    () => [...new Set(scopeKbs.flatMap((kb) => kb.embedders))],
    [scopeKbs],
  );
  const semanticAvailable = scopeKbs.some(
    (kb) => kb.vector !== null || kb.embedders.length > 0,
  );

  const setPrefs = useCallback((patch: Partial<SearchPrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      writeStorage(PREFS_KEY, next);
      return next;
    });
  }, []);

  const effectivePrefs = useMemo<SearchPrefs>(() => {
    if (!kbs) return prefs;
    const embedder =
      prefs.embedder && embedders.includes(prefs.embedder)
        ? prefs.embedder
        : (embedders[0] ?? null);
    return {
      ...prefs,
      embedder,
      mode: semanticAvailable ? prefs.mode : "keyword",
    };
  }, [prefs, embedders, semanticAvailable, kbs]);

  const value = useMemo<Workspace>(
    () => ({
      status,
      kbs,
      connections,
      kbId,
      setKbId,
      currentKb: kbs?.find((kb) => kb.id === kbId) ?? null,
      detail: detail?.id === kbId ? detail : null,
      scope,
      setScope,
      embedders,
      semanticAvailable,
      prefs: effectivePrefs,
      setPrefs,
      refreshStatus,
      refreshKbs,
      refreshDetail,
    }),
    [
      status,
      kbs,
      connections,
      kbId,
      setKbId,
      detail,
      scope,
      setScope,
      embedders,
      semanticAvailable,
      effectivePrefs,
      setPrefs,
      refreshStatus,
      refreshKbs,
      refreshDetail,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/* ------------------------------------------------------------- providers */

export function AppProviders({
  initialLang,
  children,
}: {
  initialLang: UiLang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<UiLang>(initialLang);

  const setLang = useCallback((next: UiLang) => {
    setLangState(next);
    document.cookie = `ui-lang=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  }, []);

  const i18n = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => format(DICTIONARIES[lang][key] ?? key, vars),
    }),
    [lang, setLang],
  );

  return (
    <I18nContext.Provider value={i18n}>
      <WorkspaceProvider>
        <Toaster>{children}</Toaster>
      </WorkspaceProvider>
    </I18nContext.Provider>
  );
}
