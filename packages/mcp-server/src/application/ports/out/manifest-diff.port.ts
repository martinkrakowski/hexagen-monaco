import type { ManifestDiff } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";

export interface ManifestDiffPort {
  diffAgainstGitHead(): Promise<Result<ManifestDiff>>;
  diffAgainstFile(filePath: string): Promise<Result<ManifestDiff>>;
}
