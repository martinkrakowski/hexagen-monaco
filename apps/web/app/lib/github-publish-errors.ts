import type { FetchJsonResult } from "./fetch-json";

/**
 * Machine-readable GitHub publish/push failure codes the client acts on.
 * These are the HTTP snake_case vocabulary emitted by /api/export/github and
 * /api/push/github (PR #431). Kebab-case port codes (e.g.
 * "workflow-scope-missing", "conflict") never cross the HTTP boundary as
 * actionable codes and must not appear here.
 */
export type GithubPublishErrorCode =
  | "workflow_scope_required"
  | "reauth_required";

type FetchFailure = Exclude<FetchJsonResult<unknown>, { kind: "success" }>;

/**
 * Map a failed GitHub publish/push fetch result to a UI-facing message plus
 * an actionable code (or `null` when the failure is not Reconnect-actionable).
 * Consumed by ExportContext (publish via /api/export/github) and
 * useEditorPush (push via /api/push/github).
 *
 * - `workflow_scope_required`: the server message for this code is user-ready
 *   (it already says "Reconnect GitHub … then retry"), so it passes through
 *   verbatim.
 * - `reauth_required` — or a codeless 401, which preserves the exact
 *   pre-existing client copy/behavior from before the routes emitted codes —
 *   maps to the session-expired message for the given action.
 * - Everything else, including 500 bodies whose `code` passes through
 *   kebab-case writer codes such as "conflict" (push route forwards
 *   `err.code` on unmapped failures), yields the raw message with
 *   `code: null` so it never triggers the Reconnect UI.
 */
export function mapGithubPublishFailure(
  result: FetchFailure,
  action: "publish" | "push",
): { message: string; code: GithubPublishErrorCode | null } {
  if (result.kind === "http-error") {
    if (result.code === "workflow_scope_required") {
      return { message: result.message, code: "workflow_scope_required" };
    }
    if (
      result.code === "reauth_required" ||
      (result.code === undefined && result.status === 401)
    ) {
      return {
        message: `GitHub session expired — sign in again to ${action}.`,
        code: "reauth_required",
      };
    }
  }
  return { message: result.message, code: null };
}
