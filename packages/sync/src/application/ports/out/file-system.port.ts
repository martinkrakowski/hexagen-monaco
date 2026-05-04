/**
 * File System Port
 *
 * Outbound port abstracting file system operations needed by generators.
 * This allows generators to remain pure and testable without depending
 * directly on Node.js fs module.
 */

export interface FileSystemPort {
  /**
   * Check if a path exists.
   */
  exists(filePath: string): Promise<boolean>;

  /**
   * Create a directory (and parent directories if needed).
   */
  mkdir(dirPath: string): Promise<void>;

  /**
   * Write content to a file atomically.
   */
  writeFile(
    filePath: string,
    content: string,
  ): Promise<void>;
}
