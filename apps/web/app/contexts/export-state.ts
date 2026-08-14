/**
 * Pure state types + selectors for the project export flow.
 *
 * Kept free of React / DI imports so the selector can be unit-tested in
 * isolation and so consumers (Header, ExportStatusStrip) share one definition
 * of "is the GitHub flow active" — see `isGithubExportActive`.
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

export type ExportDestination = "zip" | "github";

/**
 * Discriminated state machine for the export flow. One variant at a time;
 * illegal combinations (e.g. exporting && error) are not representable.
 */
export type ExportState =
  | { kind: "idle" }
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
  | { kind: "exporting"; destination: ExportDestination }
  | {
      kind: "success";
      destination: ExportDestination;
      message: string;
      destinationUrl?: string;
      githubLink?: GithubLinkData;
      /** Add-on materialization notice counts; the strip flips to amber when
       * `errors > 0` (full detail in the project's HEXAGEN-ADDON-NOTICES.md). */
      notices?: { warnings: number; errors: number };
      /** Raw warning strings from a degraded publish (e.g. workflow files
       * skipped for a missing OAuth scope). GitHub destination only — the ZIP
       * path surfaces notice COUNTS via sideband headers, never strings. */
      warnings?: string[];
    }
  | {
      kind: "error";
      destination: ExportDestination;
      message: string;
      /** Actionable failure code from the GitHub routes (snake_case HTTP
       * vocabulary); absent for generic failures and the ZIP destination. */
      code?: GithubPublishErrorCode;
    };

/**
 * True while the GitHub publish flow owns the prominent UI (the create dialog,
 * the settings modal, or a github-destined exporting/success/error). Derived in
 * one place so the Header `open` condition and the status strip can't drift from
 * the state machine.
 */
export function isGithubExportActive(state: ExportState): boolean {
  switch (state.kind) {
    case "dialog-open":
    case "settings-open":
      return true;
    case "exporting":
    case "success":
    case "error":
      return state.destination === "github";
    default:
      return false;
  }
}
