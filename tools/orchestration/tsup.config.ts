import { defineConfig } from "tsup";

/**
 * Bundles @hexagen-monaco/orchestration into self-contained ESM artifacts for
 * npm publishing (OW-D1, ADR-0068).
 *
 * One entry per TypeScript bin. OW-D14 fixed sixteen bin names and their final
 * paths; PB4 added `fix-brief` and PB6 added `brief-new`: the TypeScript bins are
 * built here, three (`verify-manifests`, `merge-prs`,
 * `gate-lock`) ship as shell scripts straight out of `bin/` and are never entries. A later
 * lane implementing a bin overwrites that one `src/bins/<name>.ts` stub and
 * nothing else — it never edits this file, because every path is already here.
 *
 * Each source bin carries its own `#!/usr/bin/env node` shebang (arch-linter's
 * and sync's precedent); tsup preserves it and sets the executable bit, which is
 * what makes the `bin` entries in package.json runnable.
 *
 * Third-party deps stay EXTERNAL and are declared in `dependencies`, so a
 * consumer resolves them through normal npm resolution rather than carrying a
 * second copy inside the bundle.
 */
export default defineConfig({
  entry: {
    // OW3a
    "bins/wave-event": "src/bins/wave-event.ts",
    "bins/plan-verify": "src/bins/plan-verify.ts",
    "bins/handoff-check": "src/bins/handoff-check.ts",
    "bins/control-bytes": "src/bins/control-bytes.ts",
    "bins/init": "src/bins/init.ts",
    "bins/doctor": "src/bins/doctor.ts",
    // OW3b
    "bins/plan-review": "src/bins/plan-review.ts",
    "bins/sweep": "src/bins/sweep.ts",
    "bins/mutate": "src/bins/mutate.ts",
    "bins/mutate-verify": "src/bins/mutate-verify.ts",
    "bins/mutate-anchors": "src/bins/mutate-anchors.ts",
    // OW3c. Its page is served from WAVE_STATUS_PAGE (src/internal/package-paths.ts,
    // resolved with waveStatusPageUrl(import.meta.url)), shipped by the `public`
    // entry in package.json `files`. OW3c creates that file and edits neither
    // this config nor package.json.
    "bins/wave-status": "src/bins/wave-status.ts",
    // OW3d
    "bins/gate": "src/bins/gate.ts",
    // PB4: the seventeenth bin, added after the sixteen OW-D14 pinned.
    "bins/fix-brief": "src/bins/fix-brief.ts",
    // PB6: the next bin after fix-brief, written from Template A.
    "bins/brief-new": "src/bins/brief-new.ts",
    // PB5: reads a lane's progress and usage from its server.
    "bins/lane-watch": "src/bins/lane-watch.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  minify: false,
  sourcemap: true,
  // No .d.ts: every consumer invokes a `bin`. Turn `dts` on when something
  // actually imports this package as a library.
  dts: false,
  splitting: false,
  clean: true,
  treeshake: true,

  external: ["js-yaml"],

  esbuildOptions(options) {
    options.charset = "utf8";
  },
});
