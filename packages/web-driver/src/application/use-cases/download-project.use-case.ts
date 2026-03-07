import { DownloadProjectPort } from '../../../domain';
import type { Project } from '../../../domain';

/**
 * Use case for project download / preview flow.
 * Application layer — only orchestrates the port (no direct Blob/URL/WebContainer logic).
 * Returns structured result for Intent Bus (success, downloadUrl, message).
 */
export class DownloadProjectUseCase {
  constructor(private readonly downloadPort: DownloadProjectPort) {}

  /**
   * Execute download/preview for a Project entity.
   * @param project Full Project aggregate (from projection or wizard)
   * @returns Intent-friendly result with optional downloadUrl (blob/object URL)
   */
  async execute(project: Project): Promise<{
    success: boolean;
    downloadUrl?: string;
    message: string;
    requiresConfirmation?: boolean;
  }> {
    try {
      const result = await this.downloadPort.downloadProject(project);

      // Optional cleanup (e.g. revoke old blob URLs)
      if (this.downloadPort.cleanup) {
        await this.downloadPort.cleanup();
      }

      return {
        success: result.success,
        downloadUrl: result.downloadUrl,
        message: result.message,
        requiresConfirmation: false, // download is low-risk
      };
    } catch (err) {
      return {
        success: false,
        message: `Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        requiresConfirmation: true, // destructive fallback — ask user
      };
    }
  }
}
