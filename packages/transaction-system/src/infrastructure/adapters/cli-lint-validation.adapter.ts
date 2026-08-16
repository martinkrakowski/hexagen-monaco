import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LintValidationPort } from "../../application/ports/out/lint-validation.port.js";
import type { Result } from "../../application/result.js";

const defaultExecFileAsync = promisify(execFile);

type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * `execFile` rejects for two categorically different reasons, and the port's
 * `Result` failure vs `{valid:false}` distinction is exactly that split:
 *
 *  - The linter RAN and exited non-zero. Node reports the exit status in
 *    `code` as a NUMBER. That is a lint verdict → `{valid:false, errors}`.
 *  - The linter could not run, or could not finish: spawn failure (`code` is a
 *    STRING errno such as `ENOENT`/`EACCES`), or the 60s timeout killing it
 *    (`killed`/`signal`). No verdict exists → `Result` failure.
 *
 * Anything unclassifiable is treated as "could not run". That is the safe
 * default: a wrong "could not run" reverts the patches and raises a 500, while
 * a wrong "invalid" would report an infrastructure outage to the operator as a
 * content problem — HTTP 200, no verdict, invisible to 5xx monitoring.
 */
function lintProcessRan(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; killed?: unknown; signal?: unknown };
  if (e.killed === true || typeof e.signal === "string") return false;
  return typeof e.code === "number";
}

export class CliLintValidationAdapter implements LintValidationPort {
  private readonly execFileAsync: ExecFileAsyncFn;

  constructor(
    private readonly workspaceRoot: string,
    execFileAsync?: ExecFileAsyncFn,
  ) {
    this.execFileAsync =
      execFileAsync ?? (defaultExecFileAsync as ExecFileAsyncFn);
  }

  async validateManifest(
    _manifestPath: string,
  ): Promise<Result<{ valid: boolean; errors: string[] }, Error>> {
    try {
      const { stderr } = await this.execFileAsync("yarn", ["lint:arch"], {
        cwd: this.workspaceRoot,
        timeout: 60_000,
      });

      void stderr;
      return { success: true, value: { valid: true, errors: [] } };
    } catch (errObj) {
      const error = errObj as Error & { stderr?: string | Buffer };

      if (!lintProcessRan(error)) {
        return {
          success: false,
          error: new Error(
            `Architecture linter could not be run: ${error.message || "unknown error"}`,
            { cause: error },
          ),
        };
      }

      const output = error.stderr
        ? String(error.stderr)
        : error.message || "Unknown linter error";
      const errors = output
        .split("\n")
        .filter((line: string) => line.trim().length > 0);

      return { success: true, value: { valid: false, errors } };
    }
  }
}
