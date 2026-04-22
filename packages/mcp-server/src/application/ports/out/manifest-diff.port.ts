import type { ManifestDiff, Result } from "@hexagen/shared";

export interface ManifestDiffPort {
  diffAgainstGitHead(): Promise<Result<ManifestDiff>>;
  diffAgainstFile(filePath: string): Promise<Result<ManifestDiff>>;
}
