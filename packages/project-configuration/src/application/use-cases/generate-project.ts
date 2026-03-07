import type { IGenerateProjectPort } from '../ports/in/generate-project.port';

import { Project } from '../../domain/entities/project';
import { ProjectSpecification } from '../../domain/value-objects/project-specification';

export class GenerateProjectUseCase {
  constructor(private readonly port: IGenerateProjectPort) {}

  async execute(spec: ProjectSpecification): Promise<Project> {
    // Validate basic structure
    if (!spec.name || !spec.rootName) {
      throw new Error('Project specification must include name and rootName');
    }

    // Delegate to port (infrastructure will handle persistence / file system)
    return this.port.generate(spec);
  }
}
