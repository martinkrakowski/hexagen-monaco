#!/usr/bin/env node
/**
 * Launcher for `yarn lint:arch`.
 *
 * THE DEFECT THIS EXISTS FOR. `lint:arch` used to be a bare `node dist/cli.js`.
 * `dist/` is a gitignored build artifact, so on any tree that has not been built
 * — a fresh checkout, a fresh worktree, a CI job whose build step was reordered
 * or dropped — the command died inside Node's module loader:
 *
 *     Error: Cannot find module '…/tools/arch-linter/dist/cli.js'
 *     code: 'MODULE_NOT_FOUND'
 *
 * That is a raw loader stack trace that never mentions the architecture gate,
 * and it exits **1** — the same code the linter returns when it ran fine and
 * found violations. So the two outcomes "the gate found problems" and "the gate
 * never ran at all" were indistinguishable to every caller, and the only thing
 * standing between an unbuilt linter and a green ratchet was Node happening to
 * fail rather than no-op. The whole Phase-2 enforcement ratchet rests on this
 * command; it should not rest on that.
 *
 * THE EXIT-CODE VOCABULARY (shared with tools/arch-linter/src/cli.ts):
 *
 *     0  the linter ran to completion and the tree is compliant
 *     1  the linter ran to completion and found violations
 *     2  the linter COULD NOT RUN — nothing was checked, trust nothing
 *
 * This file is deliberately dependency-free and NOT a build artifact: it has to
 * be able to run in exactly the state where the build output is missing. It is
 * also not the package's published `bin` — that stays `dist/cli.js`, because
 * `packages/sync/src/arch-linter-bin.ts` resolves the linter by existence-checking
 * that bin target and reports "arch-linter not installed" when it is absent
 * (AUD-010). Pointing `bin` at an always-present launcher would turn that honest
 * "could not verify" back into a path that fails obscurely at exec time.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXIT_COULD_NOT_RUN = 2;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.join(HERE, "..");
const ENTRY = path.join(PACKAGE_DIR, "dist", "cli.js");

/** Report an unrunnable linter as a failure that says so, and exit 2. */
function couldNotRun(reason, detail) {
  const lines = [
    "[arch-lint] FATAL: the architecture linter could not run — NOTHING WAS CHECKED.",
    `[arch-lint]   Reason: ${reason}`,
  ];
  if (detail) lines.push(`[arch-lint]   ${detail}`);
  lines.push(
    `[arch-lint]   Expected entry point: ${path.relative(process.cwd(), ENTRY)}`,
    "[arch-lint]   Build it first:  yarn turbo run build --filter=@hexagen/arch-linter",
    "[arch-lint]   (dist/ is a gitignored build artifact; CI builds it before invoking this gate —",
    "[arch-lint]    see the 'Build Packages' step in .github/workflows/lint.yml.)",
    `[arch-lint]   Exiting ${EXIT_COULD_NOT_RUN} — 'could not run', which is NOT the 0 of a clean run`,
    "[arch-lint]   and NOT the 1 of a run that found violations.",
  );
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(EXIT_COULD_NOT_RUN);
}

if (!existsSync(ENTRY)) {
  couldNotRun("the linter is not built (its entry point does not exist).");
}

try {
  // Imported rather than spawned so the CLI's own process.exit() codes (0 for
  // compliant, 1 for violations) reach the caller untranslated, and so argv
  // passes straight through — `yarn lint:arch --baseline <path>` still works.
  await import(pathToFileURL(ENTRY).href);
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    // The entry exists but one of its imports does not — an incomplete install
    // (the bundle keeps ts-morph/js-yaml/zod external) or a truncated build.
    // Still "could not run", not "ran and found nothing".
    couldNotRun(
      "the linter's entry point exists but a module it imports could not be resolved.",
      String(error.message).split("\n")[0],
    );
  }
  // Anything else means the linter DID start and then failed. That is a real
  // linter crash, not a resolution problem — let it surface with its own stack
  // and Node's default non-zero exit rather than be relabelled.
  throw error;
}
