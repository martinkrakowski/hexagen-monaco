import type { Result } from "@hexagen/shared";
import type { PullRequestMetadata } from "./version-control-system.port.js";

/**
 * Driven port for the product's second repo-WRITE surface: push a branch of
 * files to a repository the signed-in user owns and open a pull request from
 * it. Consumed by the brownfield conformance-gate flow when the user picks
 * "open a PR" instead of "download the zip".
 *
 * SECURITY POSTURE (packet BF-6.3, decision D-U3):
 *
 * - The capability is **off unless explicitly switched on** — see
 *   `PULL_REQUEST_WRITES_ENV_VAR` / `isPullRequestWriteEnabled`. An
 *   implementation MUST consult the switch before any network I/O.
 * - The write is confined to **self-owned repositories**. The OAuth token in
 *   play carries `repo` scope over every repository the user can reach (a
 *   standing property of the existing grant in `apps/web/app/lib/auth.ts`,
 *   not something this port introduces); the port narrows that blast radius
 *   to repositories whose owner IS the authenticated user.
 * - The caller does **not** choose the refs. The base is the repository's own
 *   default branch as reported by the host; the head is a fresh branch the
 *   implementation names inside a reserved `hexagen/` namespace. No existing
 *   ref is ever updated, and nothing is ever force-pushed.
 * - The token is per call and is never stored on the implementation, never
 *   logged, and never echoed into an error.
 */

/** Which repository the pull request targets. */
export interface PullRequestRepository {
  readonly owner: string;
  readonly repo: string;
}

/**
 * A file to include in the pull request, as a repo-relative path and its text
 * content. Deliberately the same shape the conformance-gate bundle emits.
 */
export interface PullRequestFile {
  readonly path: string;
  readonly content: string;
}

/**
 * What the caller may ask for.
 *
 * Note what is ABSENT and cannot be supplied: the base branch and the head
 * branch. Letting a caller name either is what turns a PR helper into an
 * arbitrary-ref writer, so the implementation derives both (see the port doc
 * comment). `branchSlug` only decorates the generated head branch name — it is
 * sanitized, always prefixed, and can never escape the `hexagen/` namespace or
 * collide with an existing ref.
 */
export interface OpenPullRequestRequest {
  readonly repository: PullRequestRepository;
  readonly title: string;
  readonly body: string;
  readonly commitMessage: string;
  readonly files: readonly PullRequestFile[];
  /** Optional human-readable fragment for the generated branch name. */
  readonly branchSlug?: string;
}

/**
 * Failure classes. Every one is a closed, machine-readable code so routes map
 * a failure without matching on message text.
 *
 * `message` is OUR sentence, written for a human, and never contains a raw
 * host response body or the token. `detail`, when present, is the host's own
 * short top-level `message` field (e.g. "Validation Failed"), truncated — the
 * rest of the response body (documentation URLs, per-field error arrays,
 * anything echoing what we submitted) is dropped rather than forwarded.
 */
export type PullRequestOpenerError = {
  readonly code: /** The kill switch is off. Nothing was contacted, nothing was written. */
    | "disabled"
    /** Request rejected before any network call. Nothing was written. */
    | "invalid-input"
    /** Token missing/expired/revoked, or lacking `repo`. Nothing was written. */
    | "auth-failed"
    /** Repo is not owned by the authenticated user (D-U3). Nothing written. */
    | "not-self-owned"
    /** Repo exists and is self-owned but is not writable (no push bit). */
    | "insufficient-permission"
    /** Repo is gone, archived, disabled, or has no commits to branch from. */
    | "repo-unavailable"
    /** Files include `.github/workflows/*` and the token lacks `workflow`. */
    | "workflow-scope-missing"
    /** A ref or pull request already exists; nothing was overwritten. */
    | "conflict"
    /** Host rate limit hit. Safe to retry later. */
    | "rate-limit"
    /** Transport failure. */
    | "network"
    /**
     * PARTIAL SUCCESS. The branch was pushed but the pull request could not be
     * opened. The repository HAS changed: `branchRef` names the branch that
     * now exists, so the user can open the pull request by hand (or delete
     * the branch). Nothing on the default branch was touched.
     */
    | "branch-written-no-pr"
    /** Anything unclassified. */
    | "unknown";
  readonly message: string;
  /** Host HTTP status, when the failure came from an HTTP response. */
  readonly status?: number;
  /** Host's own short reason, truncated. Never the full response body. */
  readonly detail?: string;
  /** Set only for `branch-written-no-pr`: the branch left behind. */
  readonly branchRef?: string;
  /** Set only for `branch-written-no-pr`: where to open the PR manually. */
  readonly compareUrl?: string;
};

/**
 * Environment variable that arms the pull-request write surface.
 *
 * DEFAULT OFF. Absent, empty, or any value other than the exact opt-in
 * literals means DISABLED — there is no "enabled unless set to false" reading
 * of this variable.
 */
export const PULL_REQUEST_WRITES_ENV_VAR = "HEXAGEN_ENABLE_PR_WRITES";

/**
 * The only two values that arm the surface, compared case-insensitively after
 * trimming. An allow-list, not a deny-list: a typo (`"tru"`, `"yes"`, `"on"`)
 * leaves the feature off, which is the safe direction to fail.
 */
const ENABLING_VALUES: ReadonlySet<string> = new Set(["1", "true"]);

/**
 * Pure predicate for the kill switch, exported so both the adapter and any
 * route can ask the same question, and so the default-off behaviour is
 * directly testable without mutating the real process environment.
 */
export function isPullRequestWriteEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[PULL_REQUEST_WRITES_ENV_VAR];
  if (typeof raw !== "string") return false;
  return ENABLING_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Open a pull request against a self-owned repository.
 *
 * `token` is supplied per call and must never be retained by an
 * implementation.
 */
export interface PullRequestOpenerPort {
  openPullRequest(
    request: OpenPullRequestRequest,
    token: string,
  ): Promise<Result<PullRequestMetadata, PullRequestOpenerError>>;
}
