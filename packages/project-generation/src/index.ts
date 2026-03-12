export * from "./domain/index.js";
export * from "./domain/entities/project";
export * from "./domain/value-objects/project-specification";
export * from "./application/generate-project-use-case";
export * from "./application/ports/in/generate-project.port";
export * from "./application/ports/out/index.js";
export * from "./infrastructure/index.js";

// Factories (exactly what wire.ts in the web driver expects)
import { GenerateProjectUseCase } from "./application/generate-project-use-case";
import type { ExternalProjectGeneratorPort } from "./application/ports/out/external-project-generator.port";
import type { ZipCreatorPort } from "./application/ports/out/zip-creator.port";

export const generateProjectUseCase = (
  generator: ExternalProjectGeneratorPort,
  zipCreator: ZipCreatorPort,
) => new GenerateProjectUseCase(generator, zipCreator);

// Placeholder for legacy downloadProjectUseCase (will be refactored later)
export const downloadProjectUseCase = () => {
  throw new Error(
    "downloadProjectUseCase not yet ported to hexagonal style — coming in next iteration",
  );
};
