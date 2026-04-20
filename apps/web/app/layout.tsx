import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "./components/providers/AuthProvider";
import { SharedStateProvider } from "@/hooks/useSharedState";
import { LocalLLMProvider } from "@/hooks/useLocalLlm";
import { EditorProvider } from "@/contexts/EditorContext";
import { ExternalIntegrationProvider } from "./contexts/ExternalIntegrationContext";
import { ActiveWorkspaceProvider } from "./contexts/ActiveWorkspaceContext";

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
        {/*
         * Flash-of-correct-theme guard — runs inline before React hydrates to
         * prevent a visible flash when the user's stored preference differs from
         * the server-rendered default. Must remain a raw <script> block.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
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
              })();
            `,
          }}
        />
        {/* theme-color keeps the mobile browser chrome in sync with the app */}
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
        <ThemeProvider>
          <SharedStateProvider>
            <EditorProvider>
              <LocalLLMProvider>
                <AuthProvider>
                  <ExternalIntegrationProvider>
                    <ActiveWorkspaceProvider>
                      {children}
                    </ActiveWorkspaceProvider>
                  </ExternalIntegrationProvider>
                </AuthProvider>
              </LocalLLMProvider>
            </EditorProvider>
          </SharedStateProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
