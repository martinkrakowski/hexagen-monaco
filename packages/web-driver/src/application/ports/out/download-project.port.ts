import type { Result } from '@hexagen/shared';
import type { Project } from '../../../domain/project.entity';

export interface DownloadError {
  code: 'DOWNLOAD_FAILED' | 'CLEANUP_FAILED';
  message: string;
  cause?: unknown;
}

/**
 * Port defining the contract for project download, preview, and deployment preparation.
 *
 * Implemented by infrastructure adapters:
 *   - WebContainerPreviewAdapter (browser in-memory preview)
 *   - Future: ServerZipAdapter, GitHubDeployAdapter, etc.
 *
 * Domain-only — no framework, no file-system, no WebContainer-specific imports.
 */
export interface DownloadProjectPort {
  /**
   * Execute the download/preview flow for a complete Project.
   *
   * @param project - The full Project entity (spec + generated structure)
   * @returns Result with optional download URL (blob/object URL) on success
   */
  downloadProject(project: Project): Promise<Result<{ downloadUrl?: string }, DownloadError>>;

  /**
   * Optional cleanup hook (e.g. revoke temporary blob URLs, unmount FS instances).
   * Called by use-case after success/error or component unmount.
   */
  cleanup?(): Promise<Result<void, DownloadError>>;
}
