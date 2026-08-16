import type { Metadata } from "next";
// Self-hosted Inter (woff2 shipped in node_modules) — no build-time fetch to
// Google Fonts, which fails on network-restricted CI runners. Exposes the
// "Inter Variable" family; --app-font-sans is set in globals.css.
import "@fontsource-variable/inter";
import "./globals.css";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "./providers/AuthProvider";
import { SharedStateProvider } from "@/hooks/useSharedState";
import { LocalLLMProvider } from "@/lib/local-llm-context";
import { ExternalIntegrationProvider } from "./contexts/ExternalIntegrationContext";
import { ActiveWorkspaceProvider } from "./contexts/ActiveWorkspaceContext";
import { SecretVaultProvider } from "@/lib/vault-context";
import { NormalizeErrors } from "./NormalizeErrors";
import { FreeTierProvider } from "@/lib/free-tier/FreeTierContext";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="theme-guard"
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
                      <FreeTierProvider>{children}</FreeTierProvider>
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
