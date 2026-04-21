import type { Result } from "@hexagen/shared";
import type {
  DownloadError,
  DownloadProjectPort,
} from "../ports/out/download-project.port";
import type { Project } from "../../domain/project.entity";

export interface DownloadResult {
  downloadUrl?: string;
  requiresConfirmation?: boolean;
}

export class DownloadProjectUseCase {
  constructor(private readonly downloadPort: DownloadProjectPort) {}

  async execute(
    project: Project,
  ): Promise<Result<DownloadResult, DownloadError>> {
    const result = await this.downloadPort.downloadProject(project);
    if (!result.success) {
      return result;
    }
    if (this.downloadPort.cleanup) {
      const cleanup = await this.downloadPort.cleanup();
      if (!cleanup.success) {
        return cleanup;
      }
    }
    return {
      success: true,
      value: {
        downloadUrl: result.value.downloadUrl,
        requiresConfirmation: false,
      },
    };
  }
}
