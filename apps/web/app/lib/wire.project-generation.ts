// apps/web/app/lib/wire.project-generation.ts
// Server-side only wiring for project generation
// This file imports Node.js modules (path, fs) and must only be used in API routes

import {
  GenerateProjectUseCase,
  ExternalSyncEngineAdapter,
  ArchiveExporterAdapter,
  GitHubExporterAdapter,
} from "@hexagen/project-generation";

export const getGenerateProject = (
  destination: "archive" | "github" = "archive",
): GenerateProjectUseCase => {
  const externalGenerator = new ExternalSyncEngineAdapter();
  const exporter =
    destination === "github"
      ? new GitHubExporterAdapter()
      : new ArchiveExporterAdapter();
  return new GenerateProjectUseCase(externalGenerator, exporter);
};
