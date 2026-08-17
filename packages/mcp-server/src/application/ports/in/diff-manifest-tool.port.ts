import type { ManifestDiff } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 *
 * Unlike its six siblings this one keeps a `Result` return channel rather than
 * throwing, because the tool adapter branches on `result.success` instead of
 * catching. That difference is the existing behaviour, preserved here.
 */
export interface DiffManifestToolInput {
  compare_source?: "git_head" | "file";
  file_path?: string;
}

export interface DiffManifestToolResult {
  diff: ManifestDiff;
  formatted: string;
}

export interface DiffManifestToolPort {
  execute(
    input?: DiffManifestToolInput,
  ): Promise<Result<DiffManifestToolResult>>;
}
