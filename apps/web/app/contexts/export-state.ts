/**
 * Pure state types + selectors for the project export flow.
 *
 * Kept free of React / DI imports so the selector can be unit-tested in
 * isolation and so consumers (Header, ExportStatusStrip) share one definition
 * of "is the GitHub flow active" — see `isGithubExportActive`.
 */

import type { PublishMode } from "@hexagen/shared";

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
      hasEditorEdits: boolean;
    }
  | { kind: "exporting"; destination: ExportDestination }
  | {
      kind: "success";
      destination: ExportDestination;
      message: string;
      destinationUrl?: string;
      githubLink?: GithubLinkData;
    }
  | { kind: "error"; destination: ExportDestination; message: string };

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
