/* eslint-disable no-console */
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveArchLinterBin } from "../../arch-linter-bin.js";
import { err, ok, type Result } from "../../domain/result.js";
import { CURRENT_SCHEMA_VERSION } from "@hexagen/shared";
import { readFileSync } from "node:fs";
import { resolveLinterTimeoutMs } from "../../linter.js";
import { runAdopt } from "../adopt/index.js";
import { runBootstrap } from "../bootstrap/index.js";
import { reportCommand } from "../report/index.js";
import { detectWorkspaces } from "../shared/detect-workspaces.js";
import { lstatExists } from "../shared/lstat-exists.js";

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
  /**
   * Machine-readable summary for non-human consumers (the web scan adapter).
   *
   * Emitted by `scanCommand` as the FINAL stdout line, after the human
   * `nextSteps`. That placement is the repo's existing convention for mixing
   * both on one stream -- `parseLintJson` reads `hexagen-lint --json` the same
   * way, taking the last trimmed line that starts with `{`.
   */
  envelope: ScanEnvelopePayload;
}

/**
 * The scan envelope. Field names are the contract the web adapter already
 * parses; `schemaVersion` comes from @hexagen/shared so producer and consumer
 * cannot drift on it independently.
 */
export interface ScanEnvelopePayload {
  schemaVersion: string;
  layout: string | null;
  filesScanned: number | null;
  reportMarkdown: string | null;
  error: string | null;
}

/**
 * Read an artifact this scan is required to have produced or kept.
 *
 * Deliberately does not catch. `layoutPath` was either just written by adopt
 * or reported as "Kept existing", so on this path any read failure -- absence
 * included -- is a real fault. --dry-run never reaches here; it builds its own
 * envelope with `layout: null`, because a preview genuinely has nothing to
 * read.
 *
 * An earlier revision caught every error and returned null, so the CLI exited
 * 0 with `layout: null, error: null`: a scan reporting success while having
 * produced nothing readable. The throw propagates to runScan's catch, which
 * returns err() and emits the failure envelope with a real message.
 */
function readRequiredArtifact(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

/**
 * Read an artifact whose ABSENCE is a legitimate outcome but whose
 * unreadability is not.
 *
 * The report writer returns the path it intends to write, and a caller may
 * inject a writer that reports a path without producing a file -- the test
 * doubles in this suite do exactly that. So ENOENT here means "no report
 * content", which `reportMarkdown: null` states honestly.
 *
 * Every OTHER errno is a genuine fault (EISDIR, EACCES, EIO) and is rethrown,
 * because those cannot mean "there is no report" -- they mean something is
 * wrong with reading one that should be there. This is the distinction the
 * previous blanket catch collapsed.
 */
function readOptionalArtifact(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
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
  const manifestLookup = await lstatExists(manifestPath);
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
    // --dry-run writes nothing, so there is nothing to report on. The envelope
    // is still emitted so a machine consumer gets the same shape on every
    // path and never has to special-case "preview returned no JSON".
    envelope: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      layout: null,
      filesScanned: null,
      reportMarkdown: null,
      error: null,
    },
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

    const layoutLookup = await lstatExists(layoutPath);
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

    const manifestLookup = await lstatExists(manifestPath);
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
    const manifestNow = await lstatExists(manifestPath);
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

    // The report is read back off disk rather than re-rendered: reportCommand
    // owns the filename, and duplicating it here is exactly the drift that made
    // `reportMarkdown` always null before (the adapter probed three names the
    // CLI never writes).
    const markdownPath = reportPaths.find((f) => f.endsWith(".md")) ?? null;

    return ok({
      layoutPath,
      manifestPath,
      wrote: wroteLayout || wroteManifest,
      lintExitCode,
      reportPaths,
      nextSteps,
      envelope: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        layout: readRequiredArtifact(layoutPath),
        filesScanned: null,
        reportMarkdown: markdownPath
          ? readOptionalArtifact(markdownPath)
          : null,
        error: null,
      },
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
    // Emit an envelope on the failure path too. `error` exists precisely so a
    // machine consumer learns WHY the scan could not run, instead of having to
    // infer it from an exit code and a human string on stderr.
    console.log(
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        layout: null,
        filesScanned: null,
        reportMarkdown: null,
        error: result.error.message,
      } satisfies ScanEnvelopePayload),
    );
    // 2, not 1. The web adapter's classifyScanExit treats 1 as "violations"
    // (layout written, lint found problems) and 2 as "could not run". This
    // branch is reached when the scan never ran at all -- refusing to write
    // without --yes, no workspaces, an unreadable artifact -- so exiting 1
    // told the UI the user's architecture has violations when nothing was
    // ever checked. The envelope already says `error: <message>` here, so the
    // exit code was also contradicting the payload beside it.
    process.exitCode = 2;
    return;
  }
  for (const line of result.value.nextSteps) {
    console.log(line);
  }
  // LAST line, after the human output. Same convention as `hexagen-lint --json`,
  // whose consumer (parseLintJson) takes the last trimmed line starting with
  // `{`. Keeping the human lines first means `hexagen scan` still reads as a
  // CLI for a person, with one machine line appended for the adapter.
  console.log(JSON.stringify(result.value.envelope));
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
