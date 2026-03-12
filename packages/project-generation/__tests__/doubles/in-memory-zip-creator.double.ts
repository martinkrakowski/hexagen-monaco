import type {
  ZipCreatorPort,
  ZipCreatorError,
} from "../../src/application/ports/out/zip-creator.port.js";
import type { Project } from "../../src/domain/entities/project.js";
import type { Result } from "@hexagen/shared";

export class InMemoryZipCreatorDouble implements ZipCreatorPort {
  private shouldFail = false;
  private failureError: ZipCreatorError | null = null;
  private createdZips: Array<{ project: Project; buffer: Buffer }> = [];
  private callCount = 0;

  setFailure(error: ZipCreatorError): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  reset(): void {
    this.shouldFail = false;
    this.failureError = null;
    this.createdZips = [];
    this.callCount = 0;
  }

  getCreatedZips(): Array<{ project: Project; buffer: Buffer }> {
    return [...this.createdZips];
  }

  getCallCount(): number {
    return this.callCount;
  }

  async createZip(project: Project): Promise<Result<Buffer, ZipCreatorError>> {
    this.callCount++;

    if (this.shouldFail && this.failureError) {
      return { success: false, error: this.failureError };
    }

    const buffer = Buffer.from(`mock-zip-for-${project.id}`);
    this.createdZips.push({ project, buffer });
    return { success: true, value: buffer };
  }
}
