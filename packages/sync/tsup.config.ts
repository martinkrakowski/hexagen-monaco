import { defineConfig } from "tsup";

export default defineConfig({
  /**
   * Sync CLI Configuration for tsup
   *
   * This config bundles @hexagen/sync into a self-contained ESM artifact suitable
   * for npm publishing. All internal workspace dependencies (@hexagen/*) are
   * inlined into the output so the published package has zero transitive
   * @hexagen/* dependencies. Third-party npm dependencies (commander, js-yaml)
   * remain external and are resolved from the consumer's node_modules via
   * standard npm peer resolution.
   *
   * See: .architecture/decisions/ADR-0009-published-cli-bundling.md
   */

  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },

  outDir: "dist",

  /**
   * Format: ESM only
   * Reason: package.json already declares "type": "module"
   */
  format: ["esm"],

  /**
   * Target: ES2022
   * Reason: Matches monorepo tsconfig.base.json
   */
  target: "es2022",

  /**
   * Minify: false
   * Reason: Easier debugging for published CLI; not performance-critical
   */
  minify: false,

  /**
   * Source maps: included
   * Reason: Aid debugging if consumers report issues
   */
  sourcemap: true,

  /**
   * Declaration: disabled
   * Reason: Type checking happens separately via `tsc --emitDeclarationOnly`.
   *         tsup's bundled DTS builder cannot traverse tsc project references.
   *         Bundle layout is: tsup → .js; tsc → .d.ts; fix-esm-barrels → imports.
   */
  dts: false,

  /**
   * Splitting: false
   * Reason: Single bundle per entry (cli.js, index.js). No chunk splitting —
   *         published CLI should be a small number of deterministic artifacts.
   */
  splitting: false,

  /**
   * Clean output before build
   */
  clean: true,

  /**
   * Tree-shaking: enabled
   * Reason: Remove unused workspace dep code from final bundle. Critical because
   *         we're inlining the full @hexagen/* dependency graph — tree-shaking
   *         trims it down to only what sync actually uses.
   */
  treeshake: true,

  /**
   * Bundle all @hexagen/* workspace packages into the sync output.
   *
   * Rationale: The four workspace dependencies (project-configuration, shared,
   * governance, visualization) are internal implementation details of sync.
   * Consumers run `npx hexagen` and never import them directly. Publishing them
   * as separate npm packages would:
   *   - force coordinated semver bumps across 5 packages for internal refactors
   *   - add 4 entries to consumer node_modules / lockfile / audit surface
   *   - expose API surface we'd be obligated to preserve forever
   *
   * Now that workspace dep dist/ is ESM-valid (Phase 6a), tsup can inline them
   * cleanly with no ERR_MODULE_NOT_FOUND risk.
   */
  noExternal: [/^@hexagen\//],

  /**
   * Third-party npm dependencies that remain external.
   *
   * These are small, stable libraries with semver-stable APIs. Leaving them
   * external avoids duplicating them in the bundle when a consumer already
   * has them in their dependency tree, and keeps the sync tarball smaller.
   *
   * They appear in package.json "dependencies", so `npm install @hexagen/sync`
   * pulls them transitively through standard npm resolution.
   */
  external: ["commander", "js-yaml"],

  /**
   * esbuild options: Configure resolution
   */
  esbuildOptions(options) {
    options.charset = "utf8";
  },

  /**
   * Post-build: copy template-engine templates into dist/templates/ so that
   * resolveTemplatesDir() can find them both in the monorepo and in a published
   * package (the staging script copies dist/ recursively, so dist/templates/ ships).
   */
  async onSuccess() {
    const { cpSync, rmSync } = await import("node:fs");
    rmSync("dist/templates", { recursive: true, force: true });
    cpSync("../template-engine/templates", "dist/templates", {
      recursive: true,
    });
  },
});
