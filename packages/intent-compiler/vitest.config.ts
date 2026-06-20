import { defineConfig } from "vitest/config";

// Spike config (ADR-0044, PR-0). Proves Vitest can run this package's existing
// node:assert tests after a runner swap. The follow-up (PR-1) hoists `resolve`
// to a shared root config; this package-local file keeps the spike contained so
// every other package stays on `node:test` (coexistence).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    // NodeNext barrels import `./x/index.js` against `.ts` sources. Mirror the
    // webpack `extensionAlias` in `next.config.mjs` (ADR-0000) so Vite resolves
    // the `.js` specifiers to their `.ts` origins — the one real technical risk
    // this spike exists to retire.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },
});
