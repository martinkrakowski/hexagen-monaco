import type { Project } from "../../../domain/entities/project";
import type { ProjectSpecification } from "../../../domain/value-objects/project-specification";

/**
 * Driven (outbound) port — ADR-0048.
 *
 * `GenerateProjectUseCase` takes this as a constructor dependency and calls
 * `generate(...)`; an infrastructure adapter (file-system, archive writer, …)
 * implements it. Both of those are the outbound direction, so the contract
 * lives under `application/ports/out`.
 */
export interface GenerateProjectPort {
  /**
   * Generates a full Project from specification.
   * Implemented by an infrastructure adapter (file-system, etc.).
   */
  generate(spec: ProjectSpecification): Promise<Project>;
}
