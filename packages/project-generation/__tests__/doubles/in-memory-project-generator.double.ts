import fs from "node:fs/promises";
import path from "node:path";
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

    const files = new Map([["README.md", "# Test Project"]]);

    // Write the core files to targetRoot like the real adapter, so use-case
    // tests exercise the genuine on-disk overwrite path (an add-on file
    // replacing a core file that already exists on disk).
    for (const [rel, content] of files) {
      const dest = path.join(targetRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content, "utf-8");
    }

    const project = Project.create({
      id: `test-${this.callCount}`,
      name: manifest.system ?? "test-project",
      rootName: manifest.system ?? "test-project",
      files,
    });

    this.generatedProjects.push(project);
    return { success: true, value: project };
  }
}
