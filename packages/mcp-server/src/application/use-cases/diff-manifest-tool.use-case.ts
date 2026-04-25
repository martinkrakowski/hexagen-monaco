import type { ManifestDiff } from "@hexagen/project-configuration";
import { formatDiff } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";
import type { ManifestDiffPort } from "../ports/out/manifest-diff.port.js";

export interface DiffManifestToolInput {
  compare_source?: "git_head" | "file";
  file_path?: string;
}

export interface DiffManifestToolResult {
  diff: ManifestDiff;
  formatted: string;
}

export class DiffManifestToolUseCase {
  constructor(private readonly manifestDiffPort: ManifestDiffPort) {}

  async execute(
    input: DiffManifestToolInput = {},
  ): Promise<Result<DiffManifestToolResult>> {
    const result =
      input.compare_source === "file" && input.file_path
        ? await this.manifestDiffPort.diffAgainstFile(input.file_path)
        : await this.manifestDiffPort.diffAgainstGitHead();

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      value: {
        diff: result.value,
        formatted: formatDiff(result.value),
      },
    };
  }
}
