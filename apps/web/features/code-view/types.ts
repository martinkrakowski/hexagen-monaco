import type { FileTreeNode } from "@hexagen/shared";

export interface ViewFileNode extends FileTreeNode {
  id: string;
  parentId?: string;
  language?: string;
  children?: ViewFileNode[];
}

/**
 * Add-on materialization notices from a generation run. Shared by the transport
 * (useProjectGeneration) and the UI (GenerationNoticesBar) so the two layers
 * can't drift the payload shape.
 */
export interface GenerationNotices {
  /** Generated files an add-on overrode — informational. */
  warnings: string[];
  /** Add-on selections that were omitted (bad selection) — see the sidecar. */
  errors: string[];
}

/**
 * Root-level sidecar the server writes when add-on notices exist; it details the
 * omitted/overridden add-ons. The same id used as a file-tree key, so the
 * notices bar can deep-link to it.
 */
export const ADDON_NOTICES_FILENAME = "HEXAGEN-ADDON-NOTICES.md";
