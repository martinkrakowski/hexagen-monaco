// Domain exports
export { Project } from "./domain/entities/project.js";

// Value objects exports
export { ProjectSpecification } from "./domain/value-objects/project-specification.js";

// Application exports
export { GenerateProjectUseCase } from "./application/generate-project-use-case.js";
export type {
  GenerateProjectInput,
  GenerateProjectOutput,
} from "./application/generate-project-use-case.js";

export type { RunProjectGenerationPort } from "./application/ports/in/generate-project.port.js";

// Ports exports (interfaces)
export type { ExternalProjectGeneratorPort } from "./application/ports/out/external-project-generator.port.js";
export type {
  ZipCreatorPort,
  ZipCreatorError,
} from "./application/ports/out/zip-creator.port.js";

// Infrastructure exports (implementations)
export { ExternalSyncEngineAdapter } from "./infrastructure/adapters/external-sync-engine.adapter.js";
export { JsZipCreatorAdapter } from "./infrastructure/adapters/jszip-creator.adapter.js";

// Factory functions
import { GenerateProjectUseCase } from "./application/generate-project-use-case.js";
import type { ExternalProjectGeneratorPort } from "./application/ports/out/external-project-generator.port.js";
import type { ZipCreatorPort } from "./application/ports/out/zip-creator.port.js";

export const generateProjectUseCase = (
  generator: ExternalProjectGeneratorPort,
  zipCreator: ZipCreatorPort,
) => new GenerateProjectUseCase(generator, zipCreator);

export const downloadProjectUseCase = () => {
  throw new Error(
    "downloadProjectUseCase not yet ported to hexagonal style — coming in next iteration",
  );
};
