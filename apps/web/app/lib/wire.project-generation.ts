// apps/web/app/lib/wire.project-generation.ts
// Server-side only wiring for project generation
// This file imports Node.js modules (path, fs) and must only be used in API routes

import {
  GenerateProjectUseCase,
  ExternalSyncEngineAdapter,
  ArchiveExporterAdapter,
  GitHubExporterAdapter,
} from "@hexagen/project-generation";

let generateProjectUseCase: GenerateProjectUseCase | null = null;

export const getGenerateProject = (
  destination: "archive" | "github" = "archive",
): GenerateProjectUseCase => {
  if (!generateProjectUseCase) {
    const externalGenerator = new ExternalSyncEngineAdapter();
    const exporter =
      destination === "github"
        ? new GitHubExporterAdapter()
        : new ArchiveExporterAdapter();
    generateProjectUseCase = new GenerateProjectUseCase(
      externalGenerator,
      exporter,
    );
  }
  return generateProjectUseCase;
};
