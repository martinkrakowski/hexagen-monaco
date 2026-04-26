import type { Result } from "../../result.js";

export interface LintValidationPort {
  validateManifest(
    manifestPath: string,
  ): Promise<Result<{ valid: boolean; errors: string[] }, Error>>;
}
