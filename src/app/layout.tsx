import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";

import { AppProviders } from "@/components/app-providers";
import { AppShell } from "@/components/app-shell";
import { resolveUiLang } from "@/lib/i18n";
import { THEME_SCRIPT } from "@/lib/theme";

import "./globals.css";

const fontSans = Geist({ variable: "--font-geist", subsets: ["latin"] });
const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CJK 搜索工作台 · CJK Search Studio",
  description:
    "Local-first search workbench for Chinese, Japanese and Korean: tokenization management, hybrid search and LLM chat on Meilisearch.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = resolveUiLang(
    (await cookies()).get("ui-lang")?.value,
    (await headers()).get("accept-language"),
  );

  return (
    <html
      lang={lang === "zh" ? "zh-CN" : "en"}
      className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          type={
            typeof window === "undefined" ? "text/javascript" : "text/plain"
          }
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body className="h-svh overflow-hidden font-sans">
        <AppProviders initialLang={lang}>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
