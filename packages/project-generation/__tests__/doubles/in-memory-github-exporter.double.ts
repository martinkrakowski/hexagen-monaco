import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "../../src/application/ports/out/project-exporter.port.js";

export class InMemoryGitHubExporterDouble implements ProjectExporterPort {
  private shouldFail = false;
  private failureError: string | null = null;
  private exportedConfigs: Array<{ sourceDir: string; config: ExportConfig }> =
    [];
  private callCount = 0;

  setFailure(error: string): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  reset(): void {
    this.shouldFail = false;
    this.failureError = null;
    this.exportedConfigs = [];
    this.callCount = 0;
  }

  getExportedConfigs(): Array<{ sourceDir: string; config: ExportConfig }> {
    return [...this.exportedConfigs];
  }

  getCallCount(): number {
    return this.callCount;
  }

  async export(
    sourceDirectory: string,
    config: ExportConfig,
  ): Promise<ExportResult> {
    this.callCount++;
    this.exportedConfigs.push({ sourceDir: sourceDirectory, config });

    if (this.shouldFail && this.failureError) {
      return {
        success: false,
        destinationUrl: "",
        error: this.failureError,
      };
    }

    return {
      success: true,
      destinationUrl: `https://github.com/${config.github?.owner}/${config.github?.repoName}`,
    };
  }
}
