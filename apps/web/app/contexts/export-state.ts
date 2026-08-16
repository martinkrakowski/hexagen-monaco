/**
 * Pure state types + selectors for the project export flows.
 *
 * Kept free of React / DI imports so the selectors can be unit-tested in
 * isolation.
 *
 * GOD-004: there used to be ONE `ExportState` union with a `destination:
 * "zip" | "github"` discriminator, which forced every ZIP consumer to receive
 * — and re-decode — the GitHub dialog/auth states. The two flows share no
 * transition: a ZIP export is a single request/download, while the GitHub
 * publish is a dialog → mode → publish → link state machine. They are two
 * unions now, and the shape makes the illegal combinations unrepresentable
 * rather than filtered out at each consumer (the old `isGithubExportActive`
 * guard existed only to undo the merge).
 */

import type { PublishMode } from "@hexagen/shared";
// Type-only import (erased at compile time), so this module stays free of
// runtime React/DI dependencies.
import type { GithubPublishErrorCode } from "@/lib/github-publish-errors";

export interface GithubLinkData {
  owner: string;
  repo: string;
  branch: string;
  defaultBranch: string;
  lastCommitSha: string | null;
  htmlUrl: string;
}

/**
 * The ZIP download flow. No dialog: the request either downloads a file or
 * reports why it could not.
 */
export type ZipExportState =
  | { kind: "idle" }
  | { kind: "exporting" }
  | {
      kind: "success";
      message: string;
      /** Add-on materialization notice counts; the strip flips to amber when
       * `errors > 0` (full detail in the project's HEXAGEN-ADDON-NOTICES.md). */
      notices?: { warnings: number; errors: number };
    }
  | { kind: "error"; message: string };

/**
 * The GitHub publish flow: create dialog, publish-settings modal, and the
 * in-flight/terminal states of a scaffold publish or an editor push.
 */
export type GithubPublishState =
  | { kind: "idle" }
  /** The create-repo dialog (first publish, or "publish to a new repo"). */
  | { kind: "dialog-open" }
  | {
      /**
       * The publish-settings modal is open (project already linked). Carries
       * the linked repo, the pre-selected mode + commit message, and whether
       * editor edits are available (gates the "editor" option).
       */
      kind: "settings-open";
      repo: { owner: string; repo: string };
      defaultMode: PublishMode;
      defaultMessage: string;
      /** Current remembered state, so the modal's checkbox reflects storage. */
      defaultRemember: boolean;
      hasEditorEdits: boolean;
    }
  | { kind: "publishing" }
  | {
      kind: "success";
      message: string;
      destinationUrl?: string;
      githubLink?: GithubLinkData;
      /** Add-on materialization notice counts. */
      notices?: { warnings: number; errors: number };
      /** Raw warning strings from a degraded publish (e.g. workflow files
       * skipped for a missing OAuth scope). */
      warnings?: string[];
    }
  | {
      kind: "error";
      message: string;
      /** Actionable failure code from the GitHub routes (snake_case HTTP
       * vocabulary); absent for generic failures. */
      code?: GithubPublishErrorCode;
    };

/**
 * True while the create/result dialog owns the prominent UI. The settings
 * modal is a SEPARATE surface rendered from the same state machine, so it is
 * excluded here — deriving both `open` conditions from one selector is what
 * kept the Header and the dialog from drifting apart.
 */
export function isPublishDialogOpen(state: GithubPublishState): boolean {
  return state.kind !== "idle" && state.kind !== "settings-open";
}
