import type { Project } from '../../../domain/entities/project';
import type { ProjectSpecification } from '../../../domain/value-objects/project-specification';

export interface IGenerateProjectPort {
  /**
   * Generates a full Project from specification.
   * Infrastructure adapter (file-system, etc.) implements this.
   */
  generate(spec: ProjectSpecification): Promise<Project>;
}
