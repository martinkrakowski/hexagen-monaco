import { defineConfig } from "vitest/config";
import baseConfig from "../../vitest.shared";

// ADR-0044 base config, specialised for the contract suites.
//
// This includes ONLY `__tests__/contract/**` — the suites that spawn the built
// CLI and perform real git/fs work (and the ts-morph public-surface scan). They
// are heavier and more timing-variable than the unit/command suites, so they get
// their own explicit timeout. The repo-wide default stays at 30s in
// vitest.shared.ts (this does NOT raise it), so a genuine hang is still caught.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["__tests__/contract/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
