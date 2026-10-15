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
import type {
  IndexDetail,
  IndexSummary,
  SearchPrefs,
  StatusInfo,
} from "@/lib/types";

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
  indexes: IndexSummary[] | null;
  indexUid: string | null;
  setIndexUid: (uid: string) => void;
  detail: IndexDetail | null;
  embedders: string[];
  prefs: SearchPrefs;
  setPrefs: (patch: Partial<SearchPrefs>) => void;
  refreshStatus: () => Promise<void>;
  refreshIndexes: () => Promise<void>;
  refreshDetail: () => Promise<void>;
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context)
    throw new Error("useWorkspace must be used inside AppProviders");
  return context;
}

const INDEX_KEY = "cjk-studio.index";
const PREFS_KEY = "cjk-studio.prefs";

function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [indexes, setIndexes] = useState<IndexSummary[] | null>(null);
  const [preferredUid, setPreferredUid] = useState<string | null>(null);
  const [detail, setDetail] = useState<IndexDetail | null>(null);
  const [prefs, setPrefsState] = useState<SearchPrefs>(DEFAULT_PREFS);

  // Restore persisted choices after mount (avoids hydration mismatches).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage
    setPreferredUid(readStorage<string | null>(INDEX_KEY, null));
    setPrefsState({ ...DEFAULT_PREFS, ...readStorage(PREFS_KEY, {}) });
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusInfo>("/api/status"));
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshIndexes = useCallback(async () => {
    try {
      const { indexes } = await api<{ indexes: IndexSummary[] }>(
        "/api/indexes",
      );
      setIndexes(indexes);
    } catch {
      setIndexes([]);
    }
  }, []);

  useEffect(() => {
    // Async loaders: state is only set after the requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
    void refreshIndexes();
  }, [refreshStatus, refreshIndexes]);

  // The selected index must exist; fall back to the first one.
  const indexUid = useMemo(() => {
    if (!indexes?.length) return null;
    if (preferredUid && indexes.some((index) => index.uid === preferredUid)) {
      return preferredUid;
    }
    return indexes[0].uid;
  }, [indexes, preferredUid]);

  const setIndexUid = useCallback((uid: string) => {
    setPreferredUid(uid);
    writeStorage(INDEX_KEY, uid);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!indexUid) {
      setDetail(null);
      return;
    }
    try {
      setDetail(
        await api<IndexDetail>(`/api/indexes/${encodeURIComponent(indexUid)}`),
      );
    } catch {
      setDetail(null);
    }
  }, [indexUid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before loading the new index
    setDetail((current) => (current?.uid === indexUid ? current : null));
    void refreshDetail();
  }, [refreshDetail, indexUid]);

  const embedders = useMemo(
    () => Object.keys(detail?.settings.embedders ?? {}),
    [detail],
  );

  const setPrefs = useCallback((patch: Partial<SearchPrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      writeStorage(PREFS_KEY, next);
      return next;
    });
  }, []);

  // Keep the chosen embedder valid for the current index.
  const effectivePrefs = useMemo<SearchPrefs>(() => {
    if (!detail) return prefs;
    const embedder =
      prefs.embedder && embedders.includes(prefs.embedder)
        ? prefs.embedder
        : (embedders[0] ?? null);
    return {
      ...prefs,
      embedder,
      mode: embedder ? prefs.mode : "keyword",
    };
  }, [prefs, embedders, detail]);

  const value = useMemo<Workspace>(
    () => ({
      status,
      indexes,
      indexUid,
      setIndexUid,
      detail: detail?.uid === indexUid ? detail : null,
      embedders,
      prefs: effectivePrefs,
      setPrefs,
      refreshStatus,
      refreshIndexes,
      refreshDetail,
    }),
    [
      status,
      indexes,
      indexUid,
      setIndexUid,
      detail,
      embedders,
      effectivePrefs,
      setPrefs,
      refreshStatus,
      refreshIndexes,
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
