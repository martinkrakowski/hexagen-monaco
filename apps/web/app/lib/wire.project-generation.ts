// apps/web/app/lib/wire.project-generation.ts
// Server-side only wiring for project generation
// This file imports Node.js modules (path, fs) and must only be used in API routes

import {
  GenerateProjectUseCase,
  ExternalSyncEngineAdapter,
  JsZipCreatorAdapter,
} from "@hexagen/project-generation";

let generateProjectUseCase: GenerateProjectUseCase | null = null;

export const getGenerateProject = (): GenerateProjectUseCase => {
  if (!generateProjectUseCase) {
    const externalGenerator = new ExternalSyncEngineAdapter();
    const zipCreator = new JsZipCreatorAdapter();
    generateProjectUseCase = new GenerateProjectUseCase(
      externalGenerator,
      zipCreator,
    );
  }
  return generateProjectUseCase;
};
