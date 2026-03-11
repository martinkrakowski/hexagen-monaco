import type { IGenerateProjectPort } from "./ports/in/generate-project.port";
import path from "node:path";
import { WorkflowGenerator } from "../infrastructure/adapters/WorkflowGenerator";
import { getWorkflowTemplatePath } from "../utils/resolveAssetPath";

import { Project } from "../domain/entities/project";
import { ProjectSpecification } from "../domain/value-objects/project-specification";
import type { ProjectConfig } from "@hexagen/project-configuration";

import { Logger, defaultLogger } from "../utils/logger";

export class GenerateProjectUseCase {
  constructor(
    private readonly port: IGenerateProjectPort,
    private readonly logger: Logger = defaultLogger,
  ) {}

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
      }),
    );
    // Inject CI workflow into the generated project
    const projectRoot = path.resolve(rootName);
    const workflowGenerator = new WorkflowGenerator(getWorkflowTemplatePath());
    await workflowGenerator.generate(projectRoot, { logger: this.logger });

    // Return minimal valid Project entity (port doesn't create it)
    return Project.create({
      id: crypto.randomUUID(),
      name: rootName,
      rootName,
    });
  }
}
