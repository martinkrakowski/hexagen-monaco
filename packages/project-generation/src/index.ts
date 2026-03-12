export * from "./domain/index.js";
export * from "./domain/entities/project";
export * from "./domain/value-objects/project-specification";
export * from "./application/generate-project-use-case";
export * from "./application/ports/in/generate-project.port";
export * from "./application/ports/out/index.js";
export * from "./infrastructure/index.js";

// Factories (exactly what wire.ts in the web driver expects)
import { GenerateProjectUseCase } from "./application/generate-project-use-case";
import type { RunProjectGenerationPort } from "./application/ports/in/generate-project.port";

export const generateProjectUseCase = (port: RunProjectGenerationPort) =>
  new GenerateProjectUseCase(port);

// Placeholder for legacy downloadProjectUseCase (will be refactored later)
export const downloadProjectUseCase = () => {
  throw new Error(
    "downloadProjectUseCase not yet ported to hexagonal style — coming in next iteration",
  );
};
