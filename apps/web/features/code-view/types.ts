/**
 * `ViewFileNode` is declared in the neutral home next to its only producer
 * (`mapToFolderTree`) and re-exported here. ADR-0055 decision 2: a neutral
 * module must not import from `features/`, and `app/lib/tree-utils.ts` used to
 * import this type back out of the slice.
 */
export type { ViewFileNode } from "@/lib/tree-utils";

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
