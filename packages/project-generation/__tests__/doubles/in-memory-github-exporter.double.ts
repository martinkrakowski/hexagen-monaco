import type {
  ExportConfig,
  ExportErrorCode,
  ExportResult,
  ProjectExporterPort,
} from "../../src/application/ports/out/project-exporter.port.js";

export class InMemoryGitHubExporterDouble implements ProjectExporterPort {
  private shouldFail = false;
  private failureError: string | null = null;
  private failureErrorCode: ExportErrorCode | undefined;
  private warnings: string[] = [];
  private exportedConfigs: Array<{ sourceDir: string; config: ExportConfig }> =
    [];
  private callCount = 0;

  setFailure(error: string, errorCode?: ExportErrorCode): void {
    this.shouldFail = true;
    this.failureError = error;
    this.failureErrorCode = errorCode;
  }

  /** Non-fatal exporter notices returned on the next successful export. */
  setWarnings(warnings: string[]): void {
    this.warnings = warnings;
  }

  reset(): void {
    this.shouldFail = false;
    this.failureError = null;
    this.failureErrorCode = undefined;
    this.warnings = [];
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
        ...(this.failureErrorCode ? { errorCode: this.failureErrorCode } : {}),
      };
    }

    return {
      success: true,
      destinationUrl: `https://github.com/${config.github?.owner}/${config.github?.repoName}`,
      ...(this.warnings.length > 0 ? { warnings: [...this.warnings] } : {}),
    };
  }
}
