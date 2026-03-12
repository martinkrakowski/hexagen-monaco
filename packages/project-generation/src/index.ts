export * from "./domain/index.js";
export * from "./domain/entities/project.js";
export * from "./domain/value-objects/project-specification.js";
export * from "./application/generate-project-use-case.js";
export * from "./application/ports/in/generate-project.port.js";
export * from "./application/ports/out/index.js";
export * from "./infrastructure/index.js";

// Factories (exactly what wire.ts in the web driver expects)
import { GenerateProjectUseCase } from "./application/generate-project-use-case.js";
import type { ExternalProjectGeneratorPort } from "./application/ports/out/external-project-generator.port.js";
import type { ZipCreatorPort } from "./application/ports/out/zip-creator.port.js";

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
