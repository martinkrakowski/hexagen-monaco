/**
 * Submit payloads for the two GitHub publish forms.
 *
 * These live here — a neutral module — rather than beside the dialogs that
 * collect them, because the publish context's PUBLIC signature is typed with
 * them. ADR-0055 (§Decision 2) requires a neutral module not to import from
 * `features/`; while these types lived in `features/export/*Dialog.tsx`, the
 * context imported them and re-published them through
 * `@/contexts/ExportContext`, structurally binding `project-wizard` and
 * `workspace-shell` to the `export` slice through a specifier containing
 * neither `../` nor a slice name. Neither of the two boundary gates could see
 * that edge (ADR-0055 §Consequences, "a laundering channel neither gate can
 * see"); `scripts/validate-ui-boundary.sh` check 7 can now.
 *
 * The dependency direction is inverted, not merely relocated: the dialogs
 * import their own submit contract from here.
 */

import type { PublishMode } from "@hexagen/shared";

/** The create-repo dialog form (first publish / "publish to a new repo"). */
export interface ScaffoldPublishSubmitPayload {
  repoName: string;
  isPrivate: boolean;
  commitMessage: string;
}

/** The publish-settings modal (mode + commit message + remember). */
export interface PublishSettingsSubmitPayload {
  mode: PublishMode;
  commitMessage: string;
  remember: boolean;
}
