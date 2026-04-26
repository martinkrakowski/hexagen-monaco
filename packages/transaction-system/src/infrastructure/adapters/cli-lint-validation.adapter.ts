import { execSync } from "node:child_process";
import type { LintValidationPort } from "../../application/ports/out/lint-validation.port.js";
import type { Result } from "../../application/result.js";

export class CliLintValidationAdapter implements LintValidationPort {
  constructor(private readonly workspaceRoot: string) {}

  async validateManifest(
    _manifestPath: string,
  ): Promise<Result<{ valid: boolean; errors: string[] }, Error>> {
    try {
      execSync("yarn lint:arch", {
        cwd: this.workspaceRoot,
        stdio: "pipe",
        timeout: 60_000,
      });

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
