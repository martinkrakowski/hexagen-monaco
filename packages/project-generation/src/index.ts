export * from './domain/entities/project';
export * from './domain/value-objects/project-specification';
export * from './application/generate-project-use-case';
export * from './application/ports/in/generate-project.port';

// Factories (exactly what wire.ts in the web driver expects)
import { GenerateProjectUseCase } from './application/generate-project-use-case';
import type { IGenerateProjectPort } from './application/ports/in/generate-project.port';

export const generateProjectUseCase = (port: IGenerateProjectPort) =>
  new GenerateProjectUseCase(port);

// Placeholder for legacy downloadProjectUseCase (will be refactored later)
export const downloadProjectUseCase = () => {
  throw new Error(
    'downloadProjectUseCase not yet ported to hexagonal style — coming in next iteration'
  );
};
