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
import { parseLintJson } from "../report/lint-collect.js";
import type { DriftSummary } from "../report/types.js";
import { detectWorkspaces } from "../shared/detect-workspaces.js";
import { lstatExists } from "../shared/lstat-exists.js";

/**
 * Findings carried by the scan envelope.
 *
 * Deliberately an ALIAS of the report package's `DriftSummary` rather than a
 * fresh interface: `parseLintJson` (commands/report/lint-collect.ts) is this
 * repo's one reader of the `hexagen-lint --json` contract and already produces
 * exactly this shape. A second shape here would make two producers of one
 * contract -- the drift that kept `reportMarkdown` null for a release.
 *
 * `collected: false` (always with a `failureReason`) is how "the findings
 * could not be read" is stated. Four empty arrays with `collected: true` mean
 * a genuinely clean tree. The two must never be collapsed: that is the same
 * "reported success while producing nothing" defect this command has already
 * been fixed for twice.
 */
export type ScanFindings = DriftSummary;

/**
 * What the lint seam reports back: the exit code that drives the scan's own
 * exit status, plus the findings read from `hexagen-lint --json`.
 *
 * A bare `number` remains accepted by {@link ScanLintRunner} so callers and
 * injected test doubles written against the pre-BF-0.3 seam keep compiling.
 * Such a runner is normalised to `collected: false`, never to an empty-but-
 * clean summary -- it genuinely reported no findings either way.
 */
export interface ScanLintOutcome {
  exitCode: number;
  findings: ScanFindings;
  /**
   * Files the linter actually walked, read from its `--json` payload.
   *
   * Null when the linter could not run or its output could not be parsed --
   * never a silent 0, which would read as "scanned nothing and passed", the
   * exact false-green this codebase's abortIfVacuous exists to prevent.
   */
  filesScanned: number | null;
}

export interface ScanLintRunner {
  (root: string): number | ScanLintOutcome | Promise<number | ScanLintOutcome>;
}

export interface ScanReportRunner {
  (options: {
    cwd: string;
    format?: "html" | "md" | "both";
    handoff?: boolean;
    handoffOut?: string;
  }): Promise<{
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
  /**
   * Also write the Tier-A handoff zip (`hexagen-handoff.zip`).
   *
   * Not a second implementation: it forwards to `reportCommand`, which already
   * owns `buildHandoffZip` and therefore owns the entry names the web ingest
   * route matches on. Duplicating the packing here is exactly the drift that
   * made `reportMarkdown` always null before.
   */
  handoff?: boolean;
  /** Handoff zip path. Relative paths resolve against `root`. */
  handoffOut?: string;
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
  /**
   * Absolute path of the handoff zip, present only when `--handoff` was asked
   * for and the report actually ran. Kept OUT of `reportPaths`: that list is
   * consumed as "the report documents" (`.md`/`.html`), and a zip in it would
   * be read as one.
   */
  handoffPath?: string;
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
  /**
   * Still always null, and NOT an oversight of BF-0.3.
   *
   * `hexagen-lint` prints `Files scanned: N` through `logger.info`, and its
   * logger is built as `createConsoleLogger(process.argv.includes("--json"))`
   * -- i.e. `--json` makes it QUIET. So the findings and the count are not
   * both obtainable from one linter run. Verified against the built linter
   * both ways: with `--json`, stdout is exactly one line (the findings JSON)
   * and the count appears nowhere; without it, `Files scanned: 1946` is on
   * stdout and there is no JSON at all.
   *
   * RESOLVED: `tools/arch-linter/src/cli.ts` now carries `filesScanned` in
   * the `--json` payload, so a single `--json` run yields both the findings
   * and the count. Left null only when the linter could not run or its
   * output could not be parsed -- never as a silent default.
   */
  filesScanned: number | null;
  reportMarkdown: string | null;
  error: string | null;
  /**
   * Findings from `hexagen-lint --json`, always present.
   *
   * Additive: the shared `ScanEnvelope` schema is `.passthrough()`, so an
   * older consumer preserves this field without understanding it and no schema
   * version bump is needed.
   *
   * The linter also emits `introduced` and `baselineGrowth`; both are
   * deliberately dropped. They are populated only under `--pr-diff`, which
   * requires a base branch to diff against -- an imported brownfield tree has
   * none, so carrying them would ship two permanently empty arrays that read
   * as "nothing was introduced" rather than "the question does not apply".
   */
  findings: ScanFindings;
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
 * Findings that were NOT read, with the reason stated.
 *
 * Never four empty arrays with `collected: true`: that would be indistinguishable
 * from a clean tree, which is the "reported success while producing nothing"
 * defect this command exists to have fixed.
 */
function uncollectedFindings(failureReason: string): ScanFindings {
  return {
    fresh: [],
    baselined: [],
    stale: [],
    expired: [],
    collected: false,
    failureReason,
  };
}

/**
 * Widen a lint runner's return value to the outcome shape.
 *
 * A runner that reports only an exit code has said nothing about findings, so
 * it normalises to `collected: false` with a reason -- "no findings were
 * collected" and "no findings exist" are different facts and the envelope has
 * to keep them apart.
 */
function toLintOutcome(value: number | ScanLintOutcome): ScanLintOutcome {
  if (typeof value === "number") {
    return {
      exitCode: value,
      findings: uncollectedFindings(
        "the lint runner reported an exit code only; hexagen-lint --json was not read",
      ),
      filesScanned: null,
    };
  }
  return value;
}

/**
 * Read `hexagen-lint --json` stdout into findings.
 *
 * The parse itself is delegated to `parseLintJson`, the report package's
 * existing reader of this contract (it takes the last trimmed line starting
 * with `{`, tolerates unknown fields, and drops malformed entries). This
 * wrapper only ensures every unsuccessful outcome carries a REASON: bare
 * `collected: false` with no explanation is the shape a renderer would show as
 * "0 findings".
 *
 * Exported for direct test coverage — `invokeHexagenLint` spawns a real
 * process, so this is the only place the stdout contract can be asserted
 * without one.
 */
/**
 * Read `filesScanned` out of the same `--json` line the findings come from.
 *
 * Deliberately separate from parseLintJson rather than widening DriftSummary:
 * that type is shared with the report path, which has no use for the count,
 * and growing a shared type to serve one caller is how contracts rot.
 */
export function collectFilesScanned(stdout: string): number | null {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .at(-1);
  if (!line) return null;
  try {
    const raw = JSON.parse(line) as { filesScanned?: unknown };
    return typeof raw.filesScanned === "number" &&
      Number.isFinite(raw.filesScanned) &&
      raw.filesScanned >= 0
      ? raw.filesScanned
      : null;
  } catch {
    return null;
  }
}

export function collectLintFindings(stdout: string): ScanFindings {
  let parsed: ScanFindings;
  try {
    parsed = parseLintJson(stdout);
  } catch (e) {
    return uncollectedFindings(
      `hexagen-lint --json output was not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  if (!parsed.collected && parsed.failureReason === undefined) {
    return uncollectedFindings(
      "hexagen-lint --json printed no JSON line, so no findings could be read",
    );
  }
  return parsed;
}

/**
 * Ceiling on captured linter stdout. `spawnSync` kills the child and reports
 * ENOBUFS past this, which this seam treats as "could not run" — deliberately
 * conservative, because a truncated findings payload must never be dressed up
 * as a verdict. 32 MiB is orders of magnitude above any real `--json` line
 * (this monorepo's is under 1 KiB) while still bounding memory.
 */
const LINT_STDOUT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Spawn the installed `hexagen-lint` bin against `root` and return both its
 * exit code and its findings. Missing bin, spawn failure, signal-kill, timeout
 * and an over-long output are all "could not run" (exit 2) — never a silent
 * pass. Vacuous scans reuse the linter's own exit 2.
 *
 * `--json` is what makes the findings readable at all, and it is why stdout is
 * PIPED where it used to be inherited. Two consequences worth stating:
 *
 *  - stderr stays INHERITED, so the user still sees the violation text live in
 *    their terminal: every violation line is `logger.error`, i.e. stderr.
 *  - the linter's console logger is constructed quiet under `--json`, so its
 *    informational stdout (including `Files scanned: N`) is not emitted at all.
 *    That is why `ScanEnvelopePayload.filesScanned` stays null; see its doc.
 *
 * Capturing stdout also keeps the linter's JSON line OFF the scan's own
 * stdout, where a stray `{`-line would compete with the envelope the web
 * adapter reads as "the last line starting with `{`".
 *
 * Posix-only (no shell). A Windows `.cmd` shim is not launched; `shell: true`
 * would reintroduce the quoting bug other execFile call sites exist to avoid.
 * CI is Ubuntu — win32 is unsupported here rather than half-supported.
 */
export function invokeHexagenLint(root: string): ScanLintOutcome {
  const bin = resolveArchLinterBin(root);
  if (bin === null) {
    console.error(
      "hexagen-lint not found — architecture was not checked (exit 2).",
    );
    return {
      exitCode: 2,
      findings: uncollectedFindings("hexagen-lint binary was not found"),
      filesScanned: null,
    };
  }

  const useNode = /\.[cm]?js$/i.test(bin);
  // `--ratchet` is the documented public name for baseline mode (the linter
  // ratchets whenever a baseline exists), and mirrors createSpawnLintCollector's
  // argv so the repo's two callers of this contract stay identical.
  const lintArgs = ["--root", root, "--json", "--ratchet"];
  const result = spawnSync(
    useNode ? process.execPath : bin,
    useNode ? [bin, ...lintArgs] : lintArgs,
    {
      cwd: root,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: LINT_STDOUT_MAX_BYTES,
      timeout: resolveLinterTimeoutMs(),
    },
  );

  if (result.error) {
    const message =
      (result.error as NodeJS.ErrnoException).code === "ENOBUFS"
        ? `hexagen-lint produced more than ${LINT_STDOUT_MAX_BYTES} bytes of output and was stopped — architecture was not checked (exit 2).`
        : `hexagen-lint failed to start: ${result.error.message}`;
    console.error(message);
    return {
      exitCode: 2,
      findings: uncollectedFindings(message),
      filesScanned: null,
    };
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  // Relay anything the linter wrote to stdout that is NOT the JSON line, so
  // piping the stream never silently swallows output a human was meant to see.
  // Under `--json` today there is none; that is a property of the current
  // linter, not something this seam should rely on.
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "" && !trimmed.startsWith("{")) {
      console.log(line);
    }
  }

  if (result.status == null) {
    return {
      exitCode: 2,
      findings: uncollectedFindings(
        `hexagen-lint exited without a status code${
          result.signal ? ` (killed by ${result.signal})` : ""
        }`,
      ),
      filesScanned: null,
    };
  }
  return {
    exitCode: result.status,
    findings: collectLintFindings(stdout),
    filesScanned: collectFilesScanned(stdout),
  };
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
      // --dry-run never spawns the linter, so there is nothing to report.
      // Stated as an uncollected summary with a reason rather than four empty
      // arrays, which a consumer would render as "a clean tree".
      findings: uncollectedFindings("--dry-run does not run hexagen-lint"),
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

    // Contradictory-flag guards, deliberately BEFORE anything is written.
    //
    // The handoff zip is packed by the report writer from the report it just
    // built, so "--handoff" without a report cannot produce one. Silently
    // ignoring the flag would hand the user a scan that looks like it honoured
    // it and no zip to upload; both refusals are usage errors, which is why
    // they take the same shape as the missing-`--yes` refusal above and land
    // on exit 2 ("could not run") rather than 1 ("violations").
    if (options.handoff === true && options.noReport === true) {
      return err(
        new Error(
          "--handoff needs the engagement report; drop --no-report (the handoff zip is packed from the report).",
        ),
      );
    }
    if (options.handoff === true && options.dryRun === true) {
      return err(
        new Error(
          "--handoff writes a file, so it cannot be combined with --dry-run. Re-run with --yes to produce the handoff zip.",
        ),
      );
    }

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

    const lintOutcome = toLintOutcome(
      await Promise.resolve((options.lint ?? invokeHexagenLint)(root)),
    );
    const lintExitCode = lintOutcome.exitCode;
    nextSteps.push(lintVerdict(lintExitCode));

    const reportPaths: string[] = [];
    let handoffPath: string | undefined;
    const manifestNow = await lstatExists(manifestPath);
    if (!manifestNow.success) return manifestNow;
    if (options.noReport !== true) {
      if (!manifestNow.value) {
        // --handoff cannot be honoured without a manifest: the zip is packed
        // from the report, and the report needs one. Failing here rather than
        // pushing the skip line keeps the flag honest -- otherwise a user who
        // ran --handoff specifically to get an upload gets no zip, no error,
        // and exit 0. Same class as the exit-code defect fixed in BF-0.1:
        // claiming success while producing nothing.
        if (options.handoff === true) {
          return err(
            new Error(
              "Cannot write a handoff zip without .architecture/manifest.yaml — the zip is packed from the report, which needs a manifest. Omit --skip-bootstrap, or run hexagen bootstrap --yes first.",
            ),
          );
        }
        nextSteps.push(
          "Skipped report — no .architecture/manifest.yaml (omit --skip-bootstrap, or run hexagen bootstrap --yes).",
        );
      } else {
        try {
          const written = await (options.report ?? reportCommand)({
            cwd: root,
            format: "both",
            handoff: options.handoff === true,
            handoffOut: options.handoffOut,
          });
          reportPaths.push(written.markdownPath, written.htmlPath);
          nextSteps.push(`Wrote ${written.markdownPath}`);
          nextSteps.push(`Wrote ${written.htmlPath}`);
          if (options.handoff === true) {
            if (written.handoffPath === undefined) {
              // Asked for, not produced. Reported as a failure rather than a
              // missing line: a user who ran --handoff to get an upload has
              // nothing to upload, and a scan that exits 0 here would be
              // claiming it honoured the flag.
              return err(
                new Error(
                  "Report ran but produced no handoff zip, so there is nothing to upload.",
                ),
              );
            }
            handoffPath = written.handoffPath;
            nextSteps.push(`Wrote ${handoffPath}`);
          }
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
      handoffPath,
      nextSteps,
      envelope: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        layout: readRequiredArtifact(layoutPath),
        // The real count, from the same --json run the findings came from.
        // Null only when the linter could not run or its output could not be
        // parsed -- never a silent 0, which reads as "scanned nothing and
        // passed".
        filesScanned: lintOutcome.filesScanned,
        reportMarkdown: markdownPath
          ? readOptionalArtifact(markdownPath)
          : null,
        error: null,
        findings: lintOutcome.findings,
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
  handoff?: boolean;
  handoffOut?: string;
}): Promise<void> {
  const result = await runScan({
    root: path.resolve(options.root ?? process.cwd()),
    yes: options.yes,
    dryRun: options.dryRun,
    force: options.force,
    skipBootstrap: options.skipBootstrap,
    noReport: options.noReport,
    handoff: options.handoff,
    handoffOut: options.handoffOut,
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
        // The scan did not complete, so whatever the linter may or may not
        // have said is not a verdict on this tree. `collected: false` says
        // that; empty arrays alone would read as "clean".
        findings: uncollectedFindings(
          `the scan did not complete, so hexagen-lint findings were not reported: ${result.error.message}`,
        ),
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
  .option(
    "--handoff",
    "Also write hexagen-handoff.zip (report + manifest + layout + baseline + ledger) for upload",
  )
  .option(
    "--handoff-out <path>",
    "Handoff zip path, relative to --root (default: <root>/hexagen-handoff.zip)",
  )
  .action(
    async (opts: {
      root?: string;
      yes?: boolean;
      dryRun?: boolean;
      force?: boolean;
      skipBootstrap?: boolean;
      report?: boolean;
      handoff?: boolean;
      handoffOut?: string;
    }) => {
      await scanCommand({
        root: opts.root,
        yes: opts.yes,
        dryRun: opts.dryRun,
        force: opts.force,
        skipBootstrap: opts.skipBootstrap,
        noReport: opts.report === false,
        handoff: opts.handoff,
        handoffOut: opts.handoffOut,
      });
    },
  );
