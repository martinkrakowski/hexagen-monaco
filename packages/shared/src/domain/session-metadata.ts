/**
 * Lightweight metadata for session listing / picker.
 * Does NOT include full editor model content.
 *
 * Part of the shared kernel — imported by monaco-orchestration and web-driver.
 */
export interface SessionMetadata {
  sessionId: string;
  projectId: string;
  timestamp: Date;
  lastModified: Date;
  patchCount: number;
  description?: string;
}
