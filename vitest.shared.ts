import { defineConfig, configDefaults } from "vitest/config";

/**
 * Shared Vitest base for migrated workspaces (ADR-0044).
 *
 * A package opts in with a `vitest.config.ts` that re-exports this base
 * (`export { default } from "../../vitest.shared";`), or `mergeConfig`s its own
 * overrides onto it (e.g. `apps/web` → jsdom environment).
 *
 * NOT named `vitest.config.*`, so Vitest never auto-loads it as a root config —
 * it is only ever imported. That matters: there is deliberately no repo-root
 * Vitest config. Turbo runs `vitest run` from each package's directory, so
 * Vitest's `root` is the package and `include` scopes to it.
 *
 * That per-package scoping originally existed so Vitest packages and not-yet-
 * migrated `node:test` packages could coexist under a single `turbo run test`.
 * **The migration is now complete** — no first-party source imports `node:test`
 * (arch-linter was the last holdout, migrated in #448 under MOD-002). The
 * per-package scoping is retained because it is still the right shape: each
 * package owns its environment (e.g. `apps/web` → jsdom) and its own `include`.
 */
export const baseConfig = defineConfig({
  test: {
    environment: "node",
    // node:test had no per-test timeout; Vitest 4 defaults to 5s, which
    // spuriously fails this repo's heavier integration/contract suites (real fs
    // I/O, full sync runs, dist builds) on slower CI runners. Give them generous
    // room — enough for genuine integration work, still finite to catch a real hang.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Relative to the package dir (the config root). Matches every layout in the
    // repo — `src/__tests__/`, a root `__tests__/`, and colocated `*.test.ts` —
    // so packages with mixed locations don't silently drop files.
    include: ["**/*.test.ts"],
    // Vitest 4's default `exclude` is only `node_modules` + `.git` (NOT `dist`),
    // so be explicit: never treat built output (`dist` — e.g. sync's emitted
    // scaffold `.test.ts`) or package-root `templates/` scaffold data as tests.
    exclude: [...configDefaults.exclude, "**/dist/**", "templates/**"],
    // Vitest 4 auto-selects the `agent` reporter when std-env's `isAgent` is
    // true (`AI_AGENT` / `CLAUDECODE` / `CURSOR_AGENT` / … are set), and that
    // reporter is MinimalReporter — `silent: "passed-only"` — so it drops every
    // console line a PASSING test produced. Warnings that only appear on a
    // passing run therefore vanish in any AI-assisted shell while CI, on the
    // same commit, reports them: `apps/web` measured 0 locally against 81 in CI
    // for exactly this reason (#509). A defect class that exists only in CI logs
    // is a defect class nobody fixes, so every workspace reports like CI does.
    //
    // The `github-actions` reporter is re-added explicitly: Vitest appends it
    // only when `reporters` is otherwise EMPTY, so pinning a reporter without
    // this would silently drop CI's failure annotations.
    //
    // Gated on `CI` rather than `GITHUB_ACTIONS` because `turbo.json` already
    // declares `CI` in `globalEnv` and is never-edit here, so `GITHUB_ACTIONS`
    // would fail `turbo/no-undeclared-env-vars` at the repo root. (`apps/web`
    // uses `GITHUB_ACTIONS` because its own ESLint config does not load the
    // turbo plugin — an inconsistency, not a licence.) The substitution is safe:
    // this repo's only CI is GitHub Actions, and the reporter emits workflow
    // commands that are inert anywhere else.
    reporters:
      process.env.CI === "true" ? ["default", "github-actions"] : ["default"],
  },
  resolve: {
    // NodeNext barrels import `./x/index.js` against `.ts` sources; mirror the
    // webpack `extensionAlias` in `next.config.mjs` (ADR-0000) so Vite resolves
    // the `.js` specifiers to their `.ts` origins.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },
});

export default baseConfig;
