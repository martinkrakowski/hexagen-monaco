import type { ProjectSpecification } from '../../../domain/value-objects/project-specification';

export interface IGenerateProjectPort {
  /**
   * Generates the full project structure from specification.
   * Infrastructure adapter (file-system, template engine, etc.) implements this.
   * Returns the generated project entity (already created in use-case).
   */
  generate(spec: ProjectSpecification): Promise<void>;
}
