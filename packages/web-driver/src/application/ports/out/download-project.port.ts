import { Project } from '../../project.entity';

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
   * @returns Result with success flag, optional download URL (blob/object URL), and human-readable message
   * @throws DownloadError on critical failure (adapter decides severity)
   */
  downloadProject(project: Project): Promise<{
    success: boolean;
    downloadUrl?: string;
    message: string;
  }>;

  /**
   * Optional cleanup hook (e.g. revoke temporary blob URLs, unmount FS instances).
   * Called by use-case after success/error or component unmount.
   */
  cleanup?(): Promise<void>;
}
