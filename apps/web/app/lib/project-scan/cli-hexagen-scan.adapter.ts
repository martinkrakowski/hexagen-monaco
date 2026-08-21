import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findMonorepoRoot } from "../monorepo-root";
import { classifyScanExit } from "./classify-scan-exit";
import { hexagenScanArgv, resolveHexagenBin } from "./hexagen-bin";
import {
  MAX_SCAN_ERROR_CHARS,
  MAX_SCAN_LAYOUT_EXCERPT_CHARS,
  MAX_SCAN_REPORT_CHARS,
  SCAN_TIMEOUT_MS,
} from "./limits";
import type { ProjectScanResponse } from "./types";
import {
  DEFAULT_ZIP_UNPACK_LIMITS,
  EmptyZipError,
  DuplicateZipEntryError,
  InvalidZipError,
  ZipResourceLimitError,
  ZipSlipError,
  unpackZipToDir,
  type ZipUnpackLimits,
} from "./zip-unpack";

export {
  ZipSlipError,
  EmptyZipError,
  InvalidZipError,
  ZipResourceLimitError,
  DuplicateZipEntryError,
};

/**
 * Unpack a zip to a temp dir and spawn `hexagen scan --yes --root <tmp>` via
 * execFile (argv array, no shell). Same posix discipline as
 * {@link CliManifestLintAdapter}: no `exec`, no interpolated command string,
 * binary resolved from the monorepo root / package bin — not `process.cwd()`
 * of apps/web.
 *
 * The sibling CLI PR (`chore/import-and-scan-cli`) owns the `scan` command.
 * This adapter honours that argv contract and is unit-tested with a fake
 * execFile so the web path can land independently.
 */

const defaultExecFileAsync = promisify(execFile);

const MAX_SCAN_STDIO_BYTES = 16 * 1024 * 1024;
const MAXBUFFER_ERROR_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

// `hexagen-report.md` first: that is the name `reportCommand` actually writes
// (packages/sync/src/commands/report/index.ts). Its absence here is why
// `reportMarkdown` was always null -- the probe list named three files the CLI
// has never produced. The legacy names are kept so an older CLI on a user's
// PATH still resolves, but they are now the fallback rather than the whole list.
const REPORT_CANDIDATES = [
  "hexagen-report.md",
  path.join(".architecture", "HEXAGEN-SCAN-REPORT.md"),
  path.join(".architecture", "scan-report.md"),
  "HEXAGEN-SCAN-REPORT.md",
] as const;

type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

interface ExecFailure extends Error {
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  code?: number | string;
  killed?: boolean;
}

export type ScanZipOutcome =
  | { kind: "scanned"; result: ProjectScanResponse }
  | {
      kind: "rejected";
      reason:
        | "zip-slip"
        | "invalid-zip"
        | "zip-too-large"
        | "duplicate-zip-entry";
      message: string;
    };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

/** Read at most `maxChars` (plus one byte to detect truncation). Never slurps. */
async function readTextClipped(
  filePath: string,
  maxChars: number,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(maxChars + 1);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return clip(buf.subarray(0, bytesRead).toString("utf8"), maxChars);
  } finally {
    await handle.close();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stdioOf(failure: ExecFailure): { stdout: string; stderr: string } {
  return {
    stdout: failure.stdout ? String(failure.stdout) : "",
    stderr: failure.stderr ? String(failure.stderr) : "",
  };
}

async function collectArtifacts(
  root: string,
  stdout: string,
  stderr: string,
): Promise<{
  layoutExcerpt: string | null;
  filesScanned: number | null;
  reportMarkdown: string | null;
  parsedError: string | null;
}> {
  let layoutExcerpt: string | null = null;
  let filesScanned: number | null = null;
  let reportMarkdown: string | null = null;
  let parsedError: string | null = null;

  // The LAST line that starts with `{`, not the whole of stdout. `hexagen scan`
  // prints its human next-steps first and appends the envelope, so requiring
  // stdout to *begin* with `{` meant this branch never fired against the real
  // CLI. Same shape as parseLintJson, which reads `hexagen-lint --json` this way.
  const envelopeLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .at(-1);
  if (envelopeLine) {
    try {
      const parsed: unknown = JSON.parse(envelopeLine);
      if (typeof parsed === "object" && parsed !== null) {
        const rec = parsed as Record<string, unknown>;
        if (typeof rec.layout === "string") {
          layoutExcerpt = clip(rec.layout, MAX_SCAN_LAYOUT_EXCERPT_CHARS);
        }
        if (
          typeof rec.filesScanned === "number" &&
          Number.isFinite(rec.filesScanned)
        ) {
          filesScanned = rec.filesScanned;
        }
        if (typeof rec.reportMarkdown === "string") {
          reportMarkdown = clip(rec.reportMarkdown, MAX_SCAN_REPORT_CHARS);
        }
        if (typeof rec.error === "string") {
          parsedError = clip(rec.error, MAX_SCAN_ERROR_CHARS);
        }
      }
    } catch {
      // stdout is not JSON — fall through to files / regex.
    }
  }

  if (layoutExcerpt === null) {
    try {
      layoutExcerpt = await readTextClipped(
        path.join(root, ".architecture", "layout.yaml"),
        MAX_SCAN_LAYOUT_EXCERPT_CHARS,
      );
    } catch {
      // layout.yaml is optional until the CLI writes it.
    }
  }

  if (reportMarkdown === null) {
    for (const rel of REPORT_CANDIDATES) {
      try {
        reportMarkdown = await readTextClipped(
          path.join(root, rel),
          MAX_SCAN_REPORT_CHARS,
        );
        break;
      } catch {
        // try next candidate
      }
    }
  }

  if (filesScanned === null) {
    const match = `${stdout}\n${stderr}`.match(/Files scanned:\s*(\d+)/i);
    if (match) filesScanned = Number(match[1]);
  }

  return { layoutExcerpt, filesScanned, reportMarkdown, parsedError };
}

export class CliHexagenScanAdapter {
  private readonly execFileAsync: ExecFileAsyncFn;
  private readonly resolveBin: (root: string) => string | null;
  private readonly execPath: string;

  constructor(
    private readonly workspaceRoot: string,
    execFileAsyncFn?: ExecFileAsyncFn,
    resolveBinFn?: (root: string) => string | null,
    execPath: string = process.execPath,
  ) {
    this.execFileAsync =
      execFileAsyncFn ?? (defaultExecFileAsync as unknown as ExecFileAsyncFn);
    this.resolveBin = resolveBinFn ?? resolveHexagenBin;
    this.execPath = execPath;
  }

  static fromMonorepoRoot(
    execFileAsyncFn?: ExecFileAsyncFn,
  ): CliHexagenScanAdapter {
    return new CliHexagenScanAdapter(findMonorepoRoot(), execFileAsyncFn);
  }

  async scanZip(input: {
    zip: Buffer;
    projectName: string;
    unpackLimits?: ZipUnpackLimits;
  }): Promise<ScanZipOutcome> {
    let dir: string;
    try {
      dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-"));
    } catch (error) {
      return {
        kind: "scanned",
        result: couldNotRun(input.projectName, null, {
          errorMessage: `Could not stage the zip for scanning: ${messageOf(error)}`,
        }),
      };
    }

    try {
      try {
        await unpackZipToDir(
          input.zip,
          dir,
          input.unpackLimits ?? DEFAULT_ZIP_UNPACK_LIMITS,
        );
      } catch (error) {
        if (error instanceof ZipSlipError) {
          return {
            kind: "rejected",
            reason: "zip-slip",
            message: error.message,
          };
        }
        if (error instanceof DuplicateZipEntryError) {
          // Explicitly rejected, not "could not run". A duplicate normalized
          // entry name is a crafted archive attempting to overwrite an earlier
          // entry -- surfacing it as a transient scan failure (HTTP 200
          // could-not-run) would hide a deliberate attack behind a shrug.
          return {
            kind: "rejected",
            reason: "duplicate-zip-entry",
            message: error.message,
          };
        }
        if (error instanceof InvalidZipError) {
          return {
            kind: "rejected",
            reason: "invalid-zip",
            message: error.message,
          };
        }
        if (error instanceof ZipResourceLimitError) {
          return {
            kind: "rejected",
            reason: "zip-too-large",
            message: error.message,
          };
        }
        if (error instanceof EmptyZipError) {
          return {
            kind: "scanned",
            result: couldNotRun(input.projectName, null, {
              errorMessage: error.message,
            }),
          };
        }
        return {
          kind: "scanned",
          result: couldNotRun(input.projectName, null, {
            errorMessage: messageOf(error),
          }),
        };
      }

      const bin = this.resolveBin(this.workspaceRoot);
      if (bin === null) {
        return {
          kind: "scanned",
          result: couldNotRun(input.projectName, null, {
            errorMessage:
              "hexagen CLI was not found on the server. Scan needs the workspace hexagen binary.",
          }),
        };
      }

      const { file, args } = hexagenScanArgv(bin, dir, this.execPath);
      let stdout = "";
      let stderr = "";
      let exitCode: number | string | null = 0;

      try {
        // 45s child vs 60s route maxDuration — unpack, cleanup, and JSON
        // must still fit after execFile returns (including on timeout).
        const result = await this.execFileAsync(file, args, {
          cwd: dir,
          timeout: SCAN_TIMEOUT_MS,
          maxBuffer: MAX_SCAN_STDIO_BYTES,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = 0;
      } catch (error) {
        const failure = error as ExecFailure;
        if (failure.code === MAXBUFFER_ERROR_CODE) {
          return {
            kind: "scanned",
            result: couldNotRun(input.projectName, null, {
              errorMessage: `hexagen scan output exceeded ${MAX_SCAN_STDIO_BYTES} bytes and was truncated; the report is incomplete.`,
            }),
          };
        }
        const stdio = stdioOf(failure);
        stdout = stdio.stdout;
        stderr = stdio.stderr;
        exitCode = failure.code ?? null;
      }

      const artifacts = await collectArtifacts(dir, stdout, stderr);
      const verdict = classifyScanExit(exitCode);
      const numericExit = typeof exitCode === "number" ? exitCode : null;
      const errorMessage =
        verdict === "could-not-run"
          ? artifacts.parsedError ||
            stderr.trim() ||
            stdout.trim() ||
            "hexagen scan could not run."
          : artifacts.parsedError;

      return {
        kind: "scanned",
        result: {
          verdict,
          exitCode: numericExit,
          projectName: input.projectName,
          layoutExcerpt: artifacts.layoutExcerpt,
          filesScanned: artifacts.filesScanned,
          reportMarkdown: artifacts.reportMarkdown,
          errorMessage:
            errorMessage && errorMessage.length > 0
              ? clip(errorMessage, MAX_SCAN_ERROR_CHARS)
              : null,
        },
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function couldNotRun(
  projectName: string,
  exitCode: number | null,
  extra: { errorMessage: string },
): ProjectScanResponse {
  return {
    verdict: "could-not-run",
    exitCode,
    projectName,
    layoutExcerpt: null,
    filesScanned: null,
    reportMarkdown: null,
    errorMessage: extra.errorMessage,
  };
}
