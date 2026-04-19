import type { Result } from "@hexagen/shared";
import type { Manifest } from "@hexagen/sync";
import type {
  GitHubExportConfig,
  ExportResult,
} from "../out/project-exporter.port.js";

export type ExportTarget = "zip" | "github";

export interface WorkspaceRef {
  projectId: string;
  manifest: Manifest;
}

export interface ExportIntent {
  target: ExportTarget;
  workspaceRef: WorkspaceRef;
  repoConfig?: GitHubExportConfig;
}

export type ZipExportValue = { zip: Buffer; filename: string };
export type GitHubExportValue = ExportResult;
export type ExportValue = ZipExportValue | GitHubExportValue;

export interface InitiateExportPort {
  validateReadiness(intent: ExportIntent): Promise<Result<true, Error>>;
  initiateExport(intent: ExportIntent): Promise<Result<ExportValue, Error>>;
}
