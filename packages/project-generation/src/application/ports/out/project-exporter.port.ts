export type ExportDestination = "archive" | "github";

export interface GitHubExportConfig {
  token: string;
  owner: string;
  repoName: string;
  isPrivate: boolean;
}

export interface ExportConfig {
  destination: ExportDestination;
  github?: GitHubExportConfig;
}

export interface ExportResult {
  success: boolean;
  destinationUrl: string;
  error?: string;
}

export interface ProjectExporterPort {
  export(sourceDirectory: string, config: ExportConfig): Promise<ExportResult>;
}
