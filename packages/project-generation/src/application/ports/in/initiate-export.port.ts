import type { Result } from "@hexagen/shared";
import type { Manifest } from "@hexagen/sync";
import type {
  GitHubExportConfig,
  ExportResult,
} from "../out/project-exporter.port.js";
import type { AddOnAnswers } from "../out/add-on-materializer.port.js";

export type ExportTarget = "zip" | "github";

export interface WorkspaceRef {
  projectId: string;
  manifest: Manifest;
}

export interface ExportIntent {
  target: ExportTarget;
  workspaceRef: WorkspaceRef;
  repoConfig?: GitHubExportConfig;
  /**
   * Per-template wizard answers, threaded into generation so the exported ZIP /
   * GitHub repo include the selected add-on templates (matching the code-view
   * path in `/api/generate`). Omitted/empty → core project only.
   */
  addOnsAnswers?: AddOnAnswers;
}

export type ZipExportValue = { zip: Buffer; filename: string };
export type GitHubExportValue = ExportResult;
export type ExportValue = ZipExportValue | GitHubExportValue;

export interface InitiateExportPort {
  validateReadiness(intent: ExportIntent): Promise<Result<true, Error>>;
  initiateExport(intent: ExportIntent): Promise<Result<ExportValue, Error>>;
}
