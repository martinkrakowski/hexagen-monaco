import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "./providers/AuthProvider";
import { SharedStateProvider } from "@/hooks/useSharedState";
import { LocalLLMProvider } from "@/llm-driver/useLocalLlm";
import { ExternalIntegrationProvider } from "./contexts/ExternalIntegrationContext";
import { ActiveWorkspaceProvider } from "./contexts/ActiveWorkspaceContext";
import { SecretVaultProvider } from "@/lib/vault-context";
import { NormalizeErrors } from "./NormalizeErrors";

/*
 * next/font/google handles subsetting, self-hosting, and injects --app-font-sans
 * as a CSS custom property on the <html> element — no external CDN request needed.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--app-font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HexaGen Monaco — Hexagonal Generator",
  description:
    "Production-ready hexagonal monorepo generator with DDD & Agentic UI",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <Script
          id="theme-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var stored = localStorage.getItem('hexagen-theme');
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                var theme = stored || (prefersDark ? 'dark' : 'light');
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            `,
          }}
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="hsl(220, 16%, 96%)"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="hsl(222, 47%, 7%)"
        />
      </head>
      <body className="antialiased">
        <NormalizeErrors />
        <SecretVaultProvider>
          <ThemeProvider>
            <SharedStateProvider>
              <LocalLLMProvider>
                <AuthProvider>
                  <ExternalIntegrationProvider>
                    <ActiveWorkspaceProvider>
                      {children}
                    </ActiveWorkspaceProvider>
                  </ExternalIntegrationProvider>
                </AuthProvider>
              </LocalLLMProvider>
            </SharedStateProvider>
          </ThemeProvider>
        </SecretVaultProvider>
      </body>
    </html>
  );
}
