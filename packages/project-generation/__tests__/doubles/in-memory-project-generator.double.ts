import type {
  ExternalProjectGeneratorPort,
  GeneratorError,
} from "../../src/application/ports/out/external-project-generator.port.js";
import type { Manifest } from "@hexagen/sync";
import type { Result } from "@hexagen/shared";
import { Project } from "../../src/domain/entities/project.js";

export class InMemoryProjectGeneratorDouble implements ExternalProjectGeneratorPort {
  private shouldFail = false;
  private failureError: GeneratorError | null = null;
  private generatedProjects: Project[] = [];
  private callCount = 0;

  setFailure(error: GeneratorError): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  reset(): void {
    this.shouldFail = false;
    this.failureError = null;
    this.generatedProjects = [];
    this.callCount = 0;
  }

  getGeneratedProjects(): Project[] {
    return [...this.generatedProjects];
  }

  getCallCount(): number {
    return this.callCount;
  }

  async generateAt(
    targetRoot: string,
    manifest: Manifest,
  ): Promise<Result<Project, GeneratorError>> {
    this.callCount++;

    if (this.shouldFail && this.failureError) {
      return { success: false, error: this.failureError };
    }

    const project = Project.create({
      id: `test-${this.callCount}`,
      name: manifest.system ?? "test-project",
      rootName: manifest.system ?? "test-project",
      files: new Map([["README.md", "# Test Project"]]),
    });

    this.generatedProjects.push(project);
    return { success: true, value: project };
  }
}
