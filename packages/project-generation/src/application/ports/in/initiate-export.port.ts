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

/**
 * Add-on materialization notices, threaded out so the export routes can surface
 * them: `warnings` (a template overrode a generated file) feed the UI; `errors`
 * (a bad selection — add-ons omitted) are *also* explained inside the artifact
 * via the HEXAGEN-ADDON-NOTICES.md the generation use case writes.
 */
export interface ExportNotices {
  warnings?: string[];
  errors?: string[];
}

export type ZipExportValue = {
  zip: Buffer;
  filename: string;
} & ExportNotices;
export type GitHubExportValue = ExportResult & ExportNotices;
export type ExportValue = ZipExportValue | GitHubExportValue;

export interface InitiateExportPort {
  validateReadiness(intent: ExportIntent): Promise<Result<true, Error>>;
  initiateExport(intent: ExportIntent): Promise<Result<ExportValue, Error>>;
}
