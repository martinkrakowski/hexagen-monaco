import { defineConfig } from "tsup";

/**
 * Bundles @hexagen-monaco/arch-linter into a self-contained ESM artifact for npm
 * publishing (ADR-0009 amendment — co-released second package).
 *
 * Private `@hexagen/*` workspace deps (project-configuration, shared) are
 * INLINED via `noExternal` so `npm install @hexagen-monaco/arch-linter` doesn't
 * 404 on packages that are never published. The type-only
 * `import type { Manifest } from "@hexagen/sync"` is erased by esbuild, so sync
 * is NOT pulled into the bundle.
 *
 * Third-party deps stay EXTERNAL and are declared in published `dependencies`,
 * so a consumer resolves them through normal npm resolution rather than carrying
 * a second copy inside the bundle.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  minify: false,
  sourcemap: true,
  // No .d.ts: arch-linter is a bin-only CLI; nothing imports it as a library.
  dts: false,
  splitting: false,
  clean: true,
  treeshake: true,

  // Inline the private workspace graph; keep the published third-party deps out.
  noExternal: [/^@hexagen\//],
  external: ["ts-morph", "chalk", "lodash", "js-yaml", "zod"],

  esbuildOptions(options) {
    options.charset = "utf8";
  },
});
