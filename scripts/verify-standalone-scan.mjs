#!/usr/bin/env node
/**
 * Assert that the built Next standalone tree can actually run a scan.
 *
 * This exists because every other gate in this repo reads SOURCE. Nothing else
 * can see what Next's file tracer copied into `.next/standalone`, and that blind
 * spot has now shipped three separate production defects:
 *
 *   1. The `hexagen` CLIs were absent from the image entirely. `@hexagen/sync`
 *      is in `transpilePackages`, so its LIBRARY exports get inlined into
 *      chunks -- but the CLI is spawned, never imported, so the tracer had no
 *      reason to keep `dist/cli.js`.
 *   2. `hexagen-lint` was traced to `tools/arch-linter`, which
 *      `resolveArchLinterBin` never consults. The tracer copies FILES, not
 *      Yarn's workspace symlinks, so the package never appeared at the
 *      `node_modules/@hexagen/arch-linter` shape the resolver walks up looking
 *      for.
 *   3. The scan routes resolved their root with `findMonorepoRoot()`, which
 *      walks up for `.architecture/manifest.yaml` and throws when absent. The
 *      standalone tree contains no yaml at all, so every scan failed before it
 *      ever looked for a binary -- and the manifest was never read by that
 *      path anyway.
 *
 * None of the three was catchable by tests, typecheck or lint. The unit tests
 * inject the root (`new CliHexagenScanAdapter(ROOT, ...)`) or mock the factory
 * (`fromMonorepoRoot: () => ({ scanZip })`), so the failing line never runs.
 * `monorepo-root.test.ts` writes its own fixture manifest, so it proves the
 * walk works and can never notice a missing tree. Type checking and linting
 * read source, and all three defects are about which FILES exist at runtime.
 *
 * So this script asserts the packaged artifact end to end: it builds a throwaway
 * project, runs the real `hexagen scan` binary out of the standalone tree, and
 * requires that findings were actually collected. A scan that "succeeds" while
 * reporting `collected: false` is the exact false-green this repo's brownfield
 * work exists to prevent, so that case fails loudly here too.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const standalone = path.join(repoRoot, "apps/web/.next/standalone");

const failures = [];
const note = (m) => console.log(`  ${m}`);

function requireFile(rel, why) {
  const full = path.join(standalone, rel);
  if (existsSync(full)) {
    note(`ok      ${rel}`);
    return true;
  }
  failures.push(`MISSING ${rel}\n          ${why}`);
  note(`MISSING ${rel}`);
  return false;
}

console.log("Standalone tree:", standalone);
if (!existsSync(standalone)) {
  console.error(
    "FATAL: no standalone output. Run `yarn turbo build --filter=web` first.",
  );
  process.exit(1);
}

console.log("\n1. Files the runtime image will contain");
const haveSync = requireFile(
  "packages/sync/dist/cli.js",
  "The scan routes spawn this. Without it resolveHexagenBin returns null and every scan reports scan_could_not_run.",
);
requireFile(
  "packages/sync/package.json",
  "resolveHexagenBin reads bin.hexagen from here; shipping the bundle alone still resolves to null.",
);
const haveLint = requireFile(
  "tools/arch-linter/dist/cli.js",
  "`hexagen scan` shells out to hexagen-lint for the actual check. Without it a scan runs and collects nothing.",
);
requireFile(
  "tools/arch-linter/package.json",
  "resolveArchLinterBin reads bin['hexagen-lint'] from here.",
);

// The installation anchor. Deliberately package.json and NOT
// .architecture/manifest.yaml: the scan path was changed to ask "where is the
// app installed" rather than "where is this repo's architecture manifest",
// because it only ever used the root to locate a binary.
console.log("\n2. Installation anchor the scan path walks up to");
requireFile(
  "package.json",
  "resolveInstallationRoot walks up for a package.json declaring `workspaces`. Without it the CLI cannot be located.",
);

if (failures.length > 0) {
  console.error(
    "\nFAILED — the packaged artifact is missing required files:\n",
  );
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// End-to-end: run the packaged binary against a throwaway project.
//
// The linter is reached the way the container reaches it -- a package link at
// the node_modules shape resolveArchLinterBin walks up to -- rather than by
// pointing the CLI straight at a path, so this exercises resolution and not
// just executability.
console.log("\n3. Running the packaged CLI against a throwaway project");
const base = mkdtempSync(path.join(tmpdir(), "hexagen-standalone-smoke-"));
let exitCode = 0;
try {
  if (haveLint) {
    const linkDir = path.join(base, "node_modules", "@hexagen");
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(
      path.join(standalone, "tools/arch-linter"),
      path.join(linkDir, "arch-linter"),
      "dir",
    );
  }

  const ws = path.join(base, "project");
  mkdirSync(path.join(ws, "src"), { recursive: true });
  writeFileSync(
    path.join(ws, "package.json"),
    JSON.stringify({ name: "smoke-target", version: "1.0.0", private: true }),
  );
  writeFileSync(
    path.join(ws, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  writeFileSync(path.join(ws, "src/index.ts"), "export const a = 1;\n");

  if (!haveSync) throw new Error("sync CLI missing; cannot run the scan");

  const stdout = execFileSync(
    process.execPath,
    [
      path.join(standalone, "packages/sync/dist/cli.js"),
      "scan",
      "--yes",
      "--root",
      ws,
    ],
    { encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
  );

  // The envelope is the last JSON line; everything before it is progress prose.
  const line = stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .pop();
  if (line === undefined) {
    throw new Error(`no JSON envelope in scan output:\n${stdout.slice(-2000)}`);
  }
  const envelope = JSON.parse(line);
  const findings = envelope.findings ?? {};

  note(`filesScanned  : ${envelope.filesScanned}`);
  note(`collected     : ${findings.collected}`);
  note(`failureReason : ${findings.failureReason ?? "none"}`);

  if (findings.collected !== true) {
    // Explicitly a failure, not a warning. A scan that runs and collects
    // nothing renders as "the scan could not be read" -- it does not crash, so
    // nothing else in CI would notice it.
    throw new Error(
      `the packaged CLI ran but collected no findings (${findings.failureReason ?? "no reason given"}). ` +
        "The binaries ship but the linter is not resolvable from the scanned tree.",
    );
  }
  console.log("\nPASSED — the packaged artifact scans and collects findings.");
} catch (error) {
  console.error(`\nFAILED — ${error instanceof Error ? error.message : error}`);
  exitCode = 1;
} finally {
  rmSync(base, { recursive: true, force: true });
}

process.exit(exitCode);
