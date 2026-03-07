/**
 * Core entity representing a HexaGen-generated project.
 * Lives in domain — pure, no infrastructure/framework dependencies.
 *
 * This is a **minimal viable entity** for the web-driver context.
 * Full richness (manifest parsing, bounded context graph, etc.) lives in project-configuration bounded context.
 * Here we project only the surface needed for persistence, preview, and download ports.
 */
export interface Project {
  /**
   * Unique identifier (e.g. UUID or slug from wizard session)
   */
  id: string;

  /**
   * Project specification snapshot (minimal subset)
   */
  spec: {
    name: string;
    description?: string;
    version?: string;
    // Future: templateId, boundedContexts list, etc.
  };

  /**
   * Root-level files (e.g. package.json, tsconfig.json, .architecture.yaml)
   * Content as string for preview/download serialization
   */
  rootFiles?: Record<string, string>;

  /**
   * High-level bounded contexts metadata
   * (Not full code — just names/roles for tree projection and preview)
   */
  boundedContexts: Array<{
    name: string;
    type: 'core' | 'supporting' | 'driver' | 'shared-kernel';
    description?: string;
  }>;

  /**
   * Timestamp of last generation/sync
   */
  lastGeneratedAt: Date;

  // Future optional fields (when we extend):
  // manifestHash?: string;
  // generatedFileTree?: FileTreeProjection;  // but avoid legacy FileTreeNode
}
