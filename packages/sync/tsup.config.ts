import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";
import { assertValidToolchainVersion } from "./src/toolchain-version.js";

/**
 * PR-A3 (RCA #1): bake the package's own version into the bundle so the
 * scaffold's `@hexagen-monaco/*` pins are derived from the engine version by
 * construction (see src/toolchain-version.ts). Resolved relative to this
 * config file, not cwd, so the guard can't be fooled by where tsup is run
 * from. Fail the BUILD on a missing/malformed/degenerate version — a broken
 * define must never reach dist. The check IS the runtime validator (review
 * #316): importing it here means the build gate and the resolver can't
 * drift apart.
 */
const pkgVersion = assertValidToolchainVersion(
  (
    JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as { version?: unknown }
  ).version,
  "packages/sync/package.json (tsup build gate)",
);

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
   *
   * `ts-morph` MUST stay external: it bundles the TypeScript compiler, whose
   * CommonJS `require("fs")` calls break when inlined into an ESM bundle
   * ("Dynamic require of fs is not supported"). Listed explicitly so it never
   * depends on tsup's "dependencies are external by default" behaviour.
   */
  external: ["commander", "js-yaml", "ts-morph"],

  /**
   * Build-time constants (PR-A3, RCA #1).
   *
   * `__HEXAGEN_TOOLCHAIN_VERSION__` becomes a string literal in BOTH entries
   * (cli.js and index.js), so every production consumer — the published CLI
   * and the wizard's Next.js server bundle, which resolves `@hexagen/sync`
   * to dist via the package `main`/`exports` — sees the engine's version
   * without any runtime `../package.json` lookup (the lookup that silently
   * yielded "0.0.0" inside server bundles).
   */
  define: {
    __HEXAGEN_TOOLCHAIN_VERSION__: JSON.stringify(pkgVersion),
  },

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
   *
   * This copy is verbatim and unfiltered: whatever sits under templates/ ends up
   * in the published tarball. What keeps a stray directory (tooling config, a
   * scratch copy) out of it is the CI gate in template-engine —
   * `discoverTemplateIds()` fails the bundle build and the template guard suite
   * by name for anything under templates/ that is not a template. Do not add a
   * second, differently-worded filter here; make that function authoritative.
   */
  async onSuccess() {
    const { cpSync, rmSync } = await import("node:fs");
    rmSync("dist/templates", { recursive: true, force: true });
    cpSync("../template-engine/templates", "dist/templates", {
      recursive: true,
    });
  },
});
