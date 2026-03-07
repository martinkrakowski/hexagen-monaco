import type { IGenerateProjectPort } from '../ports/in/generate-project.port';

import { Project } from '../../domain/entities/project';
import { ProjectSpecification } from '../../domain/value-objects/project-specification';

export class GenerateProjectUseCase {
  constructor(private readonly port: IGenerateProjectPort) {}

  async execute(rawSpec: {
    rootName?: string;
    name?: string;
    version?: string;
    description?: string;
    boundedContexts?: string[];
  }): Promise<Project> {
    // Enforce required fields at application boundary
    const name = rawSpec.name?.trim() || rawSpec.rootName?.trim();
    if (!name) {
      throw new Error('Project must have either a name or rootName');
    }

    const rootName =
      rawSpec.rootName?.trim() || name.toLowerCase().replace(/\s+/g, '-');

    // Create strict value object (will throw if invariants violated)
    const spec = ProjectSpecification.create({
      name,
      rootName,
      version: rawSpec.version,
      description: rawSpec.description,
      // boundedContexts: could be promoted to a Collection value object later
    });

    // Delegate generation to infrastructure port
    return this.port.generate(spec);
  }
}
