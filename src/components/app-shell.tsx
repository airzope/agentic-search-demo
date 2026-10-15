"use client";

import {
  DatabaseIcon,
  MessageSquareTextIcon,
  MonitorIcon,
  MoonIcon,
  ScissorsIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TextSearchIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useI18n, useWorkspace } from "@/components/app-providers";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { readStorage, writeStorage } from "@/lib/client";
import type { MessageKey } from "@/lib/i18n";
import { THEME_KEY, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: MessageKey; icon: LucideIcon }[] = [
  { href: "/", label: "nav.chat", icon: MessageSquareTextIcon },
  { href: "/search", label: "nav.search", icon: SearchIcon },
  { href: "/kb", label: "nav.indexes", icon: DatabaseIcon },
  { href: "/ontology", label: "nav.ontology", icon: WaypointsIcon },
  { href: "/tokenization", label: "nav.tokenization", icon: ScissorsIcon },
  { href: "/embedders", label: "nav.embedders", icon: SparklesIcon },
  { href: "/settings", label: "nav.settings", icon: SettingsIcon },
];

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage after mount
    setThemeState(readStorage<Theme>(THEME_KEY, "system"));
  }, []);
  const setTheme = (next: Theme) => {
    setThemeState(next);
    writeStorage(THEME_KEY, next);
    applyTheme(next);
  };
  return { theme, setTheme };
}

function IndexPicker({ className }: { className?: string }) {
  const { t } = useI18n();
  const { kbs, kbId, setKbId, connections } = useWorkspace();
  const groups = connections
    .map((connection) => ({
      connection,
      items: (kbs ?? []).filter((kb) => kb.connectionId === connection.id),
    }))
    .filter((group) => group.items.length);
  const label = (kb: NonNullable<typeof kbs>[number]) =>
    `${kb.name} · ${kb.chunked ? t("kb.chunks", { count: kb.documents }) : t("index.docs", { count: kb.documents })}`;
  return (
    <NativeSelect
      aria-label={t("index.current")}
      className={className}
      value={kbId ?? ""}
      disabled={!kbs?.length}
      onChange={(event) => setKbId(event.target.value)}
    >
      {!kbs?.length ? <option value="">{t("index.none")}</option> : null}
      {groups.length > 1
        ? groups.map((group) => (
            <optgroup key={group.connection.id} label={group.connection.name}>
              {group.items.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {label(kb)}
                </option>
              ))}
            </optgroup>
          ))
        : kbs?.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {label(kb)}
            </option>
          ))}
    </NativeSelect>
  );
}

function StatusDot() {
  const { t } = useI18n();
  const { status } = useWorkspace();
  const ok = status?.meilisearch.ok;
  return (
    <Link
      href="/settings"
      className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-2 text-xs"
      title={status?.meilisearch.host}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          status === null
            ? "bg-muted-foreground/40"
            : ok
              ? "bg-emerald-500"
              : "bg-destructive",
        )}
      />
      <span className="truncate">
        {status?.meilisearch.ok
          ? t("status.connected", { version: status.meilisearch.version })
          : status
            ? t("status.offline")
            : "…"}
      </span>
    </Link>
  );
}

const THEME_ICONS: Record<Theme, LucideIcon> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

function PreferenceToggles() {
  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const order: Theme[] = ["system", "light", "dark"];
  const ThemeIcon = THEME_ICONS[theme];
  return (
    <div className="flex items-center justify-between gap-2">
      <Segmented
        size="sm"
        aria-label={t("settings.language")}
        value={lang}
        onChange={setLang}
        options={[
          { value: "zh", label: "中文" },
          { value: "en", label: "EN" },
        ]}
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5"
        aria-label={`${t("settings.theme")}: ${t(`theme.${theme}`)}`}
        title={t(`theme.${theme}`)}
        onClick={() =>
          setTheme(order[(order.indexOf(theme) + 1) % order.length])
        }
      >
        <ThemeIcon className="size-4" />
      </button>
    </div>
  );
}

function Brand() {
  const { t } = useI18n();
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2">
      <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
        <TextSearchIcon className="size-4" />
      </span>
      <span className="truncate text-sm font-semibold tracking-tight">
        {t("app.name")}
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex h-svh min-h-0 w-full">
      <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col gap-4 border-r p-3 md:flex">
        <div className="px-1 pt-1">
          <Brand />
        </div>
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-muted-foreground text-xs font-medium">
            {t("index.current")}
          </span>
          <IndexPicker />
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors"
            >
              <Icon className="size-4" />
              {t(label)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-1">
          <StatusDot />
          <PreferenceToggles />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="bg-background flex shrink-0 flex-col gap-2 border-b px-3 pt-2.5 pb-2 md:hidden">
          <div className="flex items-center gap-2">
            <Brand />
            <IndexPicker className="ml-auto w-40" />
          </div>
          <nav
            className="-mx-1 flex gap-1 overflow-x-auto px-1"
            aria-label="Main"
          >
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className="text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium"
              >
                <Icon className="size-3.5" />
                {t(label)}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
