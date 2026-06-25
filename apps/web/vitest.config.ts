import { mergeConfig, defineConfig } from "vitest/config";
import baseConfig from "../../vitest.shared";

// apps/web renders React (incl. Next.js client components) via @testing-library,
// so tests need a DOM. Use Vitest's jsdom environment — window/document/navigator
// and the DOM constructors are globals — instead of the old per-process
// `new JSDOM()` bootstrap in test-setup.ts (now deleted).
//
// The `.test.tsx` component suites are included here. The previous runner globbed
// only `**/*.test.ts`, so they never ran in CI (issue #335); under Vitest they are
// gated like every other suite. `.spec.ts` is intentionally NOT included — that is
// the Playwright e2e suite (apps/web/playwright.config.ts), a separate runner.
export default mergeConfig(
  baseConfig,
  defineConfig({
    // Vite 8 transforms with Oxc and honors apps/web's tsconfig `jsx: "preserve"`
    // (Next.js compiles JSX itself), which would leave JSX untransformed here. The
    // old `tsx` runner forced the automatic runtime; mirror it so component suites
    // and the .tsx sources they import transform under Vitest too.
    oxc: { jsx: { runtime: "automatic", importSource: "react" } },
    // `@/*` path aliases resolved via Vite 8's native tsconfig-paths support
    // (they map to several fallback roots a plain resolve.alias can't express).
    // Unlike the vite-tsconfig-paths plugin, native resolution also applies to
    // test files, so `@/` *value* imports resolve in tests (the plugin only
    // mapped files inside the tsconfig program, which excludes `**/*.test.ts(x)`).
    resolve: { tsconfigPaths: true },
    test: {
      environment: "jsdom",
      environmentOptions: {
        // Mirror the old test-setup.ts JSDOM options: a concrete origin (some
        // client code reads window.location) and requestAnimationFrame support.
        jsdom: { url: "http://localhost", pretendToBeVisual: true },
      },
      // Explicit full list (the base contributes **/*.test.ts; duplicates are
      // harmless — Vitest dedupes matched files) so the .tsx inclusion can't be
      // lost to a merge-semantics surprise.
      include: ["**/*.test.ts", "**/*.test.tsx"],
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
);
