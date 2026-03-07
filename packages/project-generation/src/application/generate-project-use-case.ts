import type { IGenerateProjectPort } from './ports/in/generate-project.port';

import { Project } from '../domain/entities/project';
import { ProjectSpecification } from '../domain/value-objects/project-specification';
import type { ProjectConfig } from '@hexagen/project-configuration';

export class GenerateProjectUseCase {
  constructor(private readonly port: IGenerateProjectPort) {}

  async execute(fullSpec: ProjectConfig): Promise<Project> {
    const rootName = fullSpec.rootName;

    // Create domain value object (invariants enforced)
    ProjectSpecification.create({
      name: rootName,
      rootName,
    });

    // Delegate generation to infrastructure port (port only needs spec)
    await this.port.generate(
      ProjectSpecification.create({
        name: rootName,
        rootName,
      })
    );

    // Return minimal valid Project entity (port doesn't create it)
    return Project.create({
      id: crypto.randomUUID(),
      name: rootName,
      rootName,
    });
  }
}
