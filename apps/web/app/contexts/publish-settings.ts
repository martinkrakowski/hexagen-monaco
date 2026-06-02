/**
 * Pure helpers for the GitHub publish flow — default commit messages, the
 * settings modal's initial-mode resolution, and the link-aware branching
 * decision for the primary "Publish to GitHub" button. Kept free of React / DI
 * so the core branching logic is unit-testable in isolation (mirrors
 * `export-state.ts`).
 */

import type { PublishMode } from "@hexagen/shared";

/** Default commit message per mode; mirrors the server-side fallbacks. */
export const PUBLISH_MODE_MESSAGES: Record<PublishMode, string> = {
  scaffold: "Update project scaffold",
  editor: "Update from HexaGen editor",
  "new-repo": "",
};

export function defaultPublishMessage(mode: PublishMode): string {
  return PUBLISH_MODE_MESSAGES[mode];
}

/**
 * The mode the settings modal should open on: honor the preferred (remembered)
 * mode, but fall back off "editor" when there are no edits available to push.
 */
export function resolveInitialPublishMode(
  preferredMode: PublishMode,
  hasEditorEdits: boolean,
): PublishMode {
  return preferredMode === "editor" && !hasEditorEdits
    ? "scaffold"
    : preferredMode;
}

/** What the primary "Publish to GitHub" button should do, given link + prefs. */
export type PublishAction =
  | { kind: "create-dialog" }
  | { kind: "run-remembered"; mode: PublishMode }
  | { kind: "open-settings" };

/**
 * Branch the primary button:
 * - not linked → create dialog (first publish, creates the repo);
 * - linked + a remembered preference → run it directly (no modal);
 * - linked + no remembered preference → open the settings modal to ask.
 */
export function decidePublishAction(
  isLinked: boolean,
  prefs: { mode: PublishMode; remember: boolean } | null | undefined,
): PublishAction {
  if (!isLinked) return { kind: "create-dialog" };
  if (prefs?.remember) return { kind: "run-remembered", mode: prefs.mode };
  return { kind: "open-settings" };
}
