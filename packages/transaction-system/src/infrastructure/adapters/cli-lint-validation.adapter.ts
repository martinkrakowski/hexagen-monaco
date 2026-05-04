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
