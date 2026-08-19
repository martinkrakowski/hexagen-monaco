/* eslint-disable no-console */
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveArchLinterBin } from "../../arch-linter-bin.js";
import { err, ok, type Result } from "../../domain/result.js";
import { resolveLinterTimeoutMs } from "../../linter.js";
import { runAdopt } from "../adopt/index.js";
import { runBootstrap } from "../bootstrap/index.js";
import { reportCommand } from "../report/index.js";
import { detectWorkspaces } from "../shared/detect-workspaces.js";

export interface ScanLintRunner {
  (root: string): number | Promise<number>;
}

export interface ScanReportRunner {
  (options: { cwd: string; format?: "html" | "md" | "both" }): Promise<{
    markdownPath: string;
    htmlPath: string;
    handoffPath?: string;
  }>;
}

export interface ScanOptions {
  root: string;
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  skipBootstrap?: boolean;
  noReport?: boolean;
  /** Test / composition seam. Defaults to spawning hexagen-lint --root. */
  lint?: ScanLintRunner;
  /** Test / composition seam. Defaults to reportCommand. */
  report?: ScanReportRunner;
}

export interface ScanResult {
  layoutPath: string;
  manifestPath: string;
  wrote: boolean;
  lintExitCode: number;
  reportPaths: string[];
  nextSteps: string[];
}

async function pathExists(target: string): Promise<Result<boolean, Error>> {
  try {
    await fs.stat(target);
    return ok(true);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return ok(false);
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

function lintVerdict(exitCode: number): string {
  if (exitCode === 0) {
    return "Architecture check passed (exit 0).";
  }
  if (exitCode === 1) {
    return "Architecture check found violations (exit 1). See hexagen-lint output.";
  }
  return `Architecture check could not run or scanned zero files (exit ${exitCode}). This is not a pass.`;
}

/**
 * Spawn the installed `hexagen-lint` bin against `root`. Missing bin, spawn
 * failure, signal-kill, and timeout are all "could not run" (exit 2) — never
 * a silent pass. Vacuous scans reuse the linter's own exit 2.
 *
 * Posix-only (no shell). A Windows `.cmd` shim is not launched; `shell: true`
 * would reintroduce the quoting bug other execFile call sites exist to avoid.
 * CI is Ubuntu — win32 is unsupported here rather than half-supported.
 */
export function invokeHexagenLint(root: string): number {
  const bin = resolveArchLinterBin(root);
  if (bin === null) {
    console.error(
      "hexagen-lint not found — architecture was not checked (exit 2).",
    );
    return 2;
  }

  const useNode = /\.[cm]?js$/i.test(bin);
  const result = spawnSync(
    useNode ? process.execPath : bin,
    useNode ? [bin, "--root", root] : ["--root", root],
    {
      cwd: root,
      stdio: "inherit",
      timeout: resolveLinterTimeoutMs(),
    },
  );

  if (result.error) {
    console.error(`hexagen-lint failed to start: ${result.error.message}`);
    return 2;
  }
  if (result.status == null) {
    return 2;
  }
  return result.status;
}

async function previewScan(
  root: string,
  options: ScanOptions,
): Promise<Result<ScanResult, Error>> {
  const layoutPath = path.join(root, ".architecture", "layout.yaml");
  const manifestPath = path.join(root, ".architecture", "manifest.yaml");
  const adopted = await runAdopt({ root, dryRun: true });
  if (!adopted.success) return adopted;

  const nextSteps = [...adopted.value.nextSteps];
  const manifestLookup = await pathExists(manifestPath);
  if (!manifestLookup.success) return manifestLookup;
  if (!manifestLookup.value && options.skipBootstrap !== true) {
    const detection = await detectWorkspaces(root);
    nextSteps.push("Proposed bootstrap answers (not written):");
    nextSteps.push(`  system: ${detection.system}`);
    nextSteps.push("  architecture: modular-monolith");
    for (const pkg of detection.packages) {
      nextSteps.push(`  - ${pkg.name} (${pkg.root})`);
    }
    const bootstrapped = await runBootstrap({
      root,
      yes: true,
      dryRun: true,
      skipLayout: true,
    });
    if (!bootstrapped.success) return bootstrapped;
    nextSteps.push("Would write:");
    for (const file of bootstrapped.value.files) {
      nextSteps.push(`  ${file}`);
    }
  }

  return ok({
    layoutPath,
    manifestPath,
    wrote: false,
    lintExitCode: 0,
    reportPaths: [],
    nextSteps,
  });
}

export async function runScan(
  options: ScanOptions,
): Promise<Result<ScanResult, Error>> {
  try {
    const root = options.root;
    const layoutPath = path.join(root, ".architecture", "layout.yaml");
    const manifestPath = path.join(root, ".architecture", "manifest.yaml");

    if (options.dryRun === true) {
      return previewScan(root, options);
    }

    if (options.yes !== true) {
      return err(
        new Error(
          "Refusing to write architecture files without ratification. Re-run with --yes, or pass --dry-run to preview.",
        ),
      );
    }

    const layoutLookup = await pathExists(layoutPath);
    if (!layoutLookup.success) return layoutLookup;
    const layoutExists = layoutLookup.value;
    const nextSteps: string[] = [];
    let wroteLayout = false;

    if (!layoutExists || options.force === true) {
      const adopted = await runAdopt({
        root,
        yes: true,
        force: options.force,
      });
      if (!adopted.success) return adopted;
      wroteLayout = adopted.value.wrote;
      nextSteps.push(
        ...adopted.value.nextSteps.filter(
          (line) =>
            !/No manifest yet/.test(line) && !/hexagen-lint --root/.test(line),
        ),
      );
    } else {
      nextSteps.push(
        `Kept existing ${path.relative(root, layoutPath) || ".architecture/layout.yaml"}.`,
      );
    }

    const manifestLookup = await pathExists(manifestPath);
    if (!manifestLookup.success) return manifestLookup;
    let wroteManifest = false;
    if (!manifestLookup.value && options.skipBootstrap !== true) {
      const bootstrapped = await runBootstrap({
        root,
        yes: true,
        force: options.force,
        // Scan owns layout.yaml via adopt. Bootstrap writes the missing
        // manifest (and an empty baseline if that is not already populated).
        skipLayout: true,
      });
      if (!bootstrapped.success) return bootstrapped;
      wroteManifest = bootstrapped.value.wrote;
      if (wroteManifest) {
        nextSteps.push(
          "Wrote .architecture/manifest.yaml via bootstrap --yes (does not infer depends_on).",
        );
      }
    }

    const lintExitCode = await Promise.resolve(
      (options.lint ?? invokeHexagenLint)(root),
    );
    nextSteps.push(lintVerdict(lintExitCode));

    const reportPaths: string[] = [];
    const manifestNow = await pathExists(manifestPath);
    if (!manifestNow.success) return manifestNow;
    if (options.noReport !== true) {
      if (!manifestNow.value) {
        nextSteps.push(
          "Skipped report — no .architecture/manifest.yaml (omit --skip-bootstrap, or run hexagen bootstrap --yes).",
        );
      } else {
        try {
          const written = await (options.report ?? reportCommand)({
            cwd: root,
            format: "both",
          });
          reportPaths.push(written.markdownPath, written.htmlPath);
          nextSteps.push(`Wrote ${written.markdownPath}`);
          nextSteps.push(`Wrote ${written.htmlPath}`);
        } catch (e) {
          return err(
            new Error(
              `Report failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        }
      }
    }

    nextSteps.push(
      "Review layout.yaml and manifest.yaml. hexagen bootstrap does not infer depends_on from the import graph.",
    );

    return ok({
      layoutPath,
      manifestPath,
      wrote: wroteLayout || wroteManifest,
      lintExitCode,
      reportPaths,
      nextSteps,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function scanCommand(options: {
  root?: string;
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  skipBootstrap?: boolean;
  noReport?: boolean;
}): Promise<void> {
  const result = await runScan({
    root: path.resolve(options.root ?? process.cwd()),
    yes: options.yes,
    dryRun: options.dryRun,
    force: options.force,
    skipBootstrap: options.skipBootstrap,
    noReport: options.noReport,
  });
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  for (const line of result.value.nextSteps) {
    console.log(line);
  }
  process.exitCode = result.value.lintExitCode;
}

export const scanCommander = new Command("scan")
  .description(
    "Import a brownfield tree: write layout.yaml, optionally bootstrap a starting manifest, run hexagen-lint, and write an engagement report",
  )
  .option("--root <path>", "Project root (defaults to cwd)")
  .option("--yes", "Accept detected mappings and write files")
  .option(
    "--dry-run",
    "Print the proposed layout (and bootstrap answers if no manifest) without writing",
  )
  .option("--force", "Overwrite existing layout.yaml")
  .option(
    "--skip-bootstrap",
    "Do not run bootstrap even if .architecture/manifest.yaml is missing",
  )
  .option("--no-report", "Skip writing hexagen-report.md / hexagen-report.html")
  .action(
    async (opts: {
      root?: string;
      yes?: boolean;
      dryRun?: boolean;
      force?: boolean;
      skipBootstrap?: boolean;
      report?: boolean;
    }) => {
      await scanCommand({
        root: opts.root,
        yes: opts.yes,
        dryRun: opts.dryRun,
        force: opts.force,
        skipBootstrap: opts.skipBootstrap,
        noReport: opts.report === false,
      });
    },
  );
