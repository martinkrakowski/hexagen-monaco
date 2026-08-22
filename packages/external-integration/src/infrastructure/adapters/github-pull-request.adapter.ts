import { randomBytes } from "node:crypto";
import type { Result } from "@hexagen/shared";
import type {
  OpenPullRequestRequest,
  PullRequestFile,
  PullRequestOpenerError,
  PullRequestOpenerPort,
} from "../../application/ports/out/pull-request-opener.port.js";
import { isPullRequestWriteEnabled } from "../../application/ports/out/pull-request-opener.port.js";
import type { PullRequestMetadata } from "../../application/ports/out/version-control-system.port.js";
import {
  GitHubApiError,
  GitHubGitDataClient,
  isWorkflowFilePath,
  parseOAuthScopesHeader,
  WORKFLOW_SCOPE,
} from "./github-git-data.client.js";

/**
 * GitHub implementation of `PullRequestOpenerPort`.
 *
 * This is the product's first repo-write surface beyond the publish/push flow,
 * so read the safety design before changing anything here:
 *
 * 1. **Kill switch, default off.** `openPullRequest` consults
 *    `isPullRequestWriteEnabled(env)` as its FIRST statement, at call time,
 *    before it touches the token or the network. Env is read through an
 *    injected map (defaulting to `process.env`) so the check cannot be
 *    snapshotted at module load and go stale.
 * 2. **Self-owned only (D-U3).** The token carries `repo` scope over every
 *    repository the user can reach. The adapter resolves the authenticated
 *    login and the target repository's owner and refuses to write unless they
 *    are the same account. Org-owned and collaborator repositories are
 *    rejected even when the token could write them — the GitHub App migration
 *    is the answer for those, not a wider OAuth write.
 * 3. **The caller never names a ref.** The base is whatever the host reports
 *    as the repository's `default_branch`; the head is generated here inside
 *    a reserved `hexagen/` namespace with a random suffix. The branch is
 *    created with POST (create-only) — never PATCHed, never forced — so an
 *    existing ref cannot be moved or clobbered under any input.
 * 4. **Ordering bounds partial failure.** Blobs, tree and commit are all
 *    written before any ref exists. A failure before step 10 leaves only
 *    unreferenced objects, which GitHub garbage-collects: no branch, no PR,
 *    no visible change. Only a failure at the final `POST /pulls` leaves
 *    something behind, and that case has its own error code carrying the
 *    branch name so the user can finish or delete it.
 * 5. **Errors are summarized, not forwarded.** The host's response body is
 *    reduced to its top-level `message` string, truncated; the token never
 *    appears in any returned value.
 */

/** Reserved head-branch namespace. Nothing outside it is ever written. */
const BRANCH_NAMESPACE = "hexagen";

/** Fallback slug when the caller supplies none, or one that sanitizes empty. */
const DEFAULT_BRANCH_SLUG = "conformance-gate";

/** Input bounds. Deliberately small: this is a gate bundle, not a repo sync. */
const MAX_FILES = 50;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_PATH_LENGTH = 400;
const MAX_PATH_SEGMENT_LENGTH = 255;
const MAX_SLUG_LENGTH = 40;
const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 60_000;
const MAX_COMMIT_MESSAGE_LENGTH = 4_000;
const MAX_DETAIL_LENGTH = 200;

/** GitHub account-name grammar: alphanumerics and single interior hyphens. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** GitHub repository-name grammar. */
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/**
 * Conservative ref-name grammar, applied to the host-reported default branch
 * before it is interpolated into an API path. GitHub is the source of this
 * value, so this is defence in depth rather than a trust boundary — but the
 * value does reach a URL, and an absent or malformed one must not silently
 * become a request for some other resource.
 */
const REF_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,240}$/;

/** Blob mode for a regular non-executable file. */
const BLOB_MODE_FILE = "100644";

interface ValidatedRequest {
  readonly owner: string;
  readonly repo: string;
  readonly title: string;
  readonly body: string;
  readonly commitMessage: string;
  readonly files: readonly PullRequestFile[];
  readonly branchSlug: string;
}

interface RepositoryFacts {
  readonly ownerLogin: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly canPush: boolean;
  readonly archived: boolean;
  readonly disabled: boolean;
}

export interface GitHubPullRequestAdapterOptions {
  /**
   * Environment source for the kill switch. Injected so tests can prove the
   * default-off behaviour without mutating the real process environment.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Random suffix generator for the head branch name. Injected only so tests
   * can pin the branch; production uses `node:crypto`.
   */
  readonly generateBranchSuffix?: () => string;
}

export class GitHubPullRequestAdapter implements PullRequestOpenerPort {
  private readonly baseUrl = "https://api.github.com";
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly generateBranchSuffix: () => string;

  constructor(options: GitHubPullRequestAdapterOptions = {}) {
    // `process.env` is captured by REFERENCE, not copied: `env[VAR]` is read
    // on every call, so flipping the switch off does not require a restart of
    // anything holding this instance.
    this.env = options.env ?? process.env;
    this.generateBranchSuffix =
      options.generateBranchSuffix ?? (() => randomBytes(4).toString("hex"));
  }

  async openPullRequest(
    request: OpenPullRequestRequest,
    token: string,
  ): Promise<Result<PullRequestMetadata, PullRequestOpenerError>> {
    // ---- 1. Kill switch. First statement, before the token is even read. ----
    if (!isPullRequestWriteEnabled(this.env)) {
      return failure({
        code: "disabled",
        message:
          "Opening pull requests is switched off in this deployment. " +
          "Download the gate bundle instead, or ask an operator to enable " +
          "the pull-request write surface.",
      });
    }

    if (typeof token !== "string" || token.trim().length === 0) {
      return failure({
        code: "auth-failed",
        message:
          "No GitHub credential was supplied. Reconnect GitHub and retry.",
      });
    }

    // ---- 2. Validate every caller-supplied value. No network yet. ----
    const validated = validateRequest(request);
    if (!validated.success) return validated;
    const input = validated.value;

    // The branch name is derived here, up front, so the partial-failure path
    // at step 10 can name it. Nothing about it comes from the caller except a
    // sanitized decorative slug.
    const headBranch = this.buildHeadBranch(input.branchSlug);
    if (!REF_NAME_PATTERN.test(headBranch)) {
      // Unreachable given the sanitizer, kept as an assertion: a future edit
      // that loosens the sanitizer must fail closed, not write a strange ref.
      return failure({
        code: "invalid-input",
        message: "Could not derive a safe branch name for this pull request.",
      });
    }

    const client = new GitHubGitDataClient();

    // Tracks whether the one ref-mutating call has been ISSUED (not whether it
    // succeeded). Everything before it writes only unreferenced git objects,
    // which are invisible and garbage-collected — so up to that point the
    // adapter can honestly promise "nothing was written", and after it cannot.
    let refWriteAttempted = false;

    try {
      // ---- 3. Who is the token? (login + OAuth scopes in one round trip) ----
      const viewer = await this.getAuthenticatedUser(token);

      // ---- 4. Workflow-scope preflight, before any write. ----
      // The conformance gate ships `.github/workflows/*`, so this is the
      // common path here, not the exception. `scopes === null` means the
      // header was absent (unknown) — fail open, exactly as the sibling
      // adapters do, because `createTree` reactively remaps the resulting
      // opaque 404 into the same typed code.
      const workflowFiles = input.files
        .map((file) => file.path)
        .filter(isWorkflowFilePath);
      if (
        workflowFiles.length > 0 &&
        viewer.scopes !== null &&
        !viewer.scopes.has(WORKFLOW_SCOPE)
      ) {
        return failure({
          code: "workflow-scope-missing",
          message:
            `This pull request would add ${workflowFiles.join(", ")}, which ` +
            "requires the 'workflow' OAuth scope. The connected GitHub " +
            "token lacks it. Reconnect GitHub to grant workflow permission, " +
            "then retry.",
        });
      }

      // ---- 5. Authorization: self-owned repositories only (D-U3). ----
      const repository = await this.getRepository(
        token,
        input.owner,
        input.repo,
      );

      // The D-U3 decision itself, and deliberately the FIRST of the two
      // repository checks: a user who points this at somebody else's
      // repository must be told exactly that, not given a vaguer message from
      // the redirect check below.
      if (repository.ownerLogin.toLowerCase() !== viewer.login.toLowerCase()) {
        return failure({
          code: "not-self-owned",
          message:
            `Pull requests can only be opened against repositories owned by ` +
            `the signed-in account. ${input.owner}/${input.repo} is owned by ` +
            `${repository.ownerLogin}, not ${viewer.login}. Download the ` +
            "gate bundle and open the pull request from your own workflow.",
        });
      }
      // `fetch` follows redirects, and GitHub 301s `GET /repos/{o}/{r}` to a
      // repository's new location after a rename or a transfer. So the record
      // just authorized is not necessarily the one living at the path the
      // writes below address. Require the resolved identity to be exactly what
      // was asked for — otherwise the self-owned decision was made about a
      // different repository than the one that gets written to.
      if (
        repository.ownerLogin.toLowerCase() !== input.owner.toLowerCase() ||
        repository.name.toLowerCase() !== input.repo.toLowerCase()
      ) {
        return failure({
          code: "repo-unavailable",
          message:
            `GitHub resolved ${input.owner}/${input.repo} to ` +
            `${repository.ownerLogin}/${repository.name}, which means it has ` +
            "been renamed or transferred. Re-select the repository and retry. " +
            "Nothing was written.",
        });
      }

      if (repository.archived || repository.disabled) {
        return failure({
          code: "repo-unavailable",
          message: `${input.owner}/${input.repo} is ${
            repository.archived ? "archived" : "disabled"
          } and cannot accept a pull request.`,
        });
      }
      if (!repository.canPush) {
        return failure({
          code: "insufficient-permission",
          message:
            `The connected GitHub token cannot push to ${input.owner}/` +
            `${input.repo}. Reconnect GitHub, or download the gate bundle ` +
            "instead.",
        });
      }
      if (!REF_NAME_PATTERN.test(repository.defaultBranch)) {
        return failure({
          code: "repo-unavailable",
          message: `${input.owner}/${input.repo} reported an unusable default branch.`,
        });
      }

      // ---- 6. Base commit. An empty repository has nothing to branch from. --
      const baseSha = await client.getBranchHeadSha(
        token,
        input.owner,
        input.repo,
        repository.defaultBranch,
      );
      if (baseSha === null) {
        return failure({
          code: "repo-unavailable",
          message:
            `${input.owner}/${input.repo} has no commit on its default ` +
            `branch (${repository.defaultBranch}), so there is nothing to ` +
            "open a pull request against.",
        });
      }
      const baseTreeSha = await client.getCommitTreeSha(
        token,
        input.owner,
        input.repo,
        baseSha,
      );
      if (baseTreeSha === undefined) {
        // FAIL CLOSED. `createTree` without a `base_tree` produces a tree
        // containing ONLY our files, so the resulting commit would show every
        // other file in the repository as deleted. A pull request that quietly
        // proposes deleting the user's codebase is far worse than an error, so
        // an unreadable base tree stops here instead of degrading.
        return failure({
          code: "repo-unavailable",
          message:
            `Could not read the current tree of ${input.owner}/${input.repo} ` +
            `at ${repository.defaultBranch}, so the pull request could not be ` +
            "built on top of it. Nothing was written.",
        });
      }

      // ---- 7-9. Objects first, ref last: a failure here leaves no ref. -----
      const treeEntries = [];
      for (const file of input.files) {
        const blobSha = await client.createBlob(
          token,
          input.owner,
          input.repo,
          Buffer.from(file.content, "utf8").toString("base64"),
          "base64",
        );
        treeEntries.push({
          path: file.path,
          mode: BLOB_MODE_FILE,
          type: "blob",
          sha: blobSha,
        });
      }

      const treeSha = await client.createTree(
        token,
        input.owner,
        input.repo,
        treeEntries,
        baseTreeSha,
      );

      const commitSha = await client.createCommit(
        token,
        input.owner,
        input.repo,
        treeSha,
        input.commitMessage,
        [baseSha],
      );

      // ---- 10. Create the branch. `branchExisted: false` = POST only. ------
      // This is the only call that mutates a ref, and it can only CREATE one.
      // The client remaps GitHub's "Reference already exists" 422 to a 409,
      // which maps below to `conflict` — so a name collision aborts instead of
      // overwriting somebody's branch.
      // From here on, "nothing was written" is no longer a claim we can make:
      // a transport failure on this very call can leave the ref created on
      // GitHub's side with no response reaching us.
      refWriteAttempted = true;
      await client.upsertRef(
        token,
        input.owner,
        input.repo,
        headBranch,
        commitSha,
        false,
      );

      // ---- 11. Open the pull request. Past this line, the repo has changed. -
      try {
        return await this.createPullRequest(
          token,
          input,
          repository.defaultBranch,
          headBranch,
        );
      } catch (err) {
        const summary = summarizeError(err);
        return failure({
          code: "branch-written-no-pr",
          message:
            `The branch ${headBranch} was pushed to ${input.owner}/` +
            `${input.repo}, but the pull request may not have been opened. ` +
            "Nothing on the default branch changed. Check the repository: " +
            "open the pull request from that branch manually if it is not " +
            "already there, or delete the branch.",
          ...(summary.status !== undefined ? { status: summary.status } : {}),
          ...(summary.detail !== undefined ? { detail: summary.detail } : {}),
          branchRef: headBranch,
          compareUrl:
            `https://github.com/${input.owner}/${input.repo}/compare/` +
            `${encodeRefForUrl(repository.defaultBranch)}...` +
            `${encodeRefForUrl(headBranch)}?expand=1`,
        });
      }
    } catch (err) {
      return failure(mapGitHubError(err, refWriteAttempted));
    }
  }

  /**
   * Build the head branch: a fixed namespace, a sanitized slug, and a random
   * suffix. Because the namespace prefix is non-empty and unconditional, the
   * result can never be a bare branch name like `main` regardless of input.
   */
  private buildHeadBranch(slug: string): string {
    return `${BRANCH_NAMESPACE}/${slug}-${this.generateBranchSuffix()}`;
  }

  /**
   * Resolve the token's owner login and its OAuth scopes from one `GET /user`.
   * `scopes: null` = the `x-oauth-scopes` header was absent (unknown).
   */
  private async getAuthenticatedUser(
    token: string,
  ): Promise<{ login: string; scopes: Set<string> | null }> {
    const response = await this.request(token, "GET", "/user");
    const data = (await readJson(response)) as { login?: unknown };
    if (typeof data.login !== "string" || data.login.length === 0) {
      throw new GitHubApiError(
        502,
        "GitHub did not return an authenticated user.",
      );
    }
    // Optional-chained for parity with the sibling adapters, whose fetch
    // doubles return header-less responses; a missing bag means the same
    // thing as a missing header.
    const scopes = parseOAuthScopesHeader(
      response.headers?.get?.("x-oauth-scopes"),
    );
    return { login: data.login, scopes };
  }

  /** Read the facts the authorization decision depends on. */
  private async getRepository(
    token: string,
    owner: string,
    repo: string,
  ): Promise<RepositoryFacts> {
    const response = await this.request(
      token,
      "GET",
      `/repos/${owner}/${repo}`,
    );
    const data = (await readJson(response)) as {
      owner?: { login?: unknown };
      name?: unknown;
      default_branch?: unknown;
      permissions?: { push?: unknown };
      archived?: unknown;
      disabled?: unknown;
    };
    const ownerLogin = data.owner?.login;
    if (typeof ownerLogin !== "string" || ownerLogin.length === 0) {
      // Without an owner we cannot make the ownership decision, and an
      // undecidable authorization check must fail closed.
      throw new GitHubApiError(
        502,
        "GitHub did not report the repository owner.",
      );
    }
    if (typeof data.name !== "string" || data.name.length === 0) {
      throw new GitHubApiError(
        502,
        "GitHub did not report the repository name.",
      );
    }
    return {
      ownerLogin,
      name: data.name,
      defaultBranch:
        typeof data.default_branch === "string" ? data.default_branch : "",
      // `permissions` is omitted for repositories the token can only read,
      // so an absent bag means "no push", not "assume push".
      canPush: data.permissions?.push === true,
      archived: data.archived === true,
      disabled: data.disabled === true,
    };
  }

  /**
   * `POST /pulls`. Throws on failure so the caller can distinguish "branch
   * pushed, PR failed" from every earlier failure.
   */
  private async createPullRequest(
    token: string,
    input: ValidatedRequest,
    baseBranch: string,
    headBranch: string,
  ): Promise<Result<PullRequestMetadata, PullRequestOpenerError>> {
    const response = await this.request(
      token,
      "POST",
      `/repos/${input.owner}/${input.repo}/pulls`,
      {
        title: input.title,
        body: input.body,
        head: headBranch,
        base: baseBranch,
      },
    );
    const data = (await readJson(response)) as {
      number?: unknown;
      html_url?: unknown;
      title?: unknown;
      created_at?: unknown;
    };
    if (typeof data.number !== "number" || typeof data.html_url !== "string") {
      throw new GitHubApiError(
        502,
        "GitHub accepted the pull request but returned an unreadable response.",
      );
    }
    const createdAt =
      typeof data.created_at === "string"
        ? new Date(data.created_at)
        : new Date(Number.NaN);
    return {
      success: true,
      value: {
        prNumber: data.number,
        prUrl: data.html_url,
        title: typeof data.title === "string" ? data.title : input.title,
        // A missing or unparseable timestamp is cosmetic metadata, not a
        // reason to fail a pull request that GitHub already opened.
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
        baseBranch,
        headBranch,
      },
    };
  }

  /**
   * Minimal request helper, mirroring `GitHubExporterAdapter`'s inline style
   * (the shared client's own `request` is private, and this packet must not
   * widen another adapter's surface). Non-2xx throws `GitHubApiError` with
   * the same message shape the sibling adapters produce.
   */
  private async request(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        detail = "parse error";
      }
      throw new GitHubApiError(
        response.status,
        `GitHub API error (${response.status}): ${detail}`,
      );
    }
    return response;
  }
}

/** Narrow helper so every failure path is one expression. */
function failure(
  error: PullRequestOpenerError,
): Result<PullRequestMetadata, PullRequestOpenerError> {
  return { success: false, error };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const parsed = (await response.json()) as unknown;
  if (parsed === null || typeof parsed !== "object") {
    throw new GitHubApiError(502, "GitHub returned an unreadable response.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Percent-encode a ref for a github.com URL while keeping `/` as a separator
 * (branch names legitimately contain it, and GitHub's compare URLs expect it
 * unencoded).
 */
function encodeRefForUrl(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/**
 * Reduce a thrown error to (status, detail).
 *
 * `GitHubApiError.message` embeds the whole serialized response body. That
 * body is NOT safe to hand back — it carries documentation URLs, per-field
 * error arrays, and can echo submitted content. So we parse it and keep only
 * the top-level `message` string (GitHub's own short reason: "Not Found",
 * "Validation Failed", "Bad credentials"), truncated and stripped of control
 * characters. Anything we cannot parse yields no detail at all rather than a
 * raw passthrough.
 */
function summarizeError(err: unknown): {
  status?: number;
  detail?: string;
} {
  if (!(err instanceof GitHubApiError)) return {};
  const braceIndex = err.message.indexOf("{");
  if (braceIndex === -1) return { status: err.status };
  let parsed: unknown;
  try {
    parsed = JSON.parse(err.message.slice(braceIndex));
  } catch {
    return { status: err.status };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { status: err.status };
  }
  const hostMessage = (parsed as { message?: unknown }).message;
  if (typeof hostMessage !== "string") return { status: err.status };
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point
  const cleaned = hostMessage.replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (cleaned.length === 0) return { status: err.status };
  return {
    status: err.status,
    detail:
      cleaned.length > MAX_DETAIL_LENGTH
        ? `${cleaned.slice(0, MAX_DETAIL_LENGTH)}…`
        : cleaned,
  };
}

/**
 * Sentence appended to every mapped failure, stating what the caller can rely
 * on about the repository's state.
 *
 * `refWriteAttempted` is about the create-ref call being ISSUED, not about it
 * succeeding: once that request has left the process, a transport failure can
 * no longer distinguish "GitHub never saw it" from "GitHub created the ref and
 * the response was lost". Claiming "nothing was written" there would be a
 * confident lie, and a user acting on it would not go looking for the branch.
 */
function writeOutcomeSentence(refWriteAttempted: boolean): string {
  return refWriteAttempted
    ? " The branch may or may not have been created; check the repository " +
        "before retrying. Nothing on the default branch changed."
    : " Nothing was written.";
}

/** Map a thrown error onto the port's closed error vocabulary. */
function mapGitHubError(
  err: unknown,
  refWriteAttempted: boolean,
): PullRequestOpenerError {
  const outcome = writeOutcomeSentence(refWriteAttempted);
  if (err instanceof GitHubApiError) {
    const summary = summarizeError(err);
    const withSummary = (
      code: PullRequestOpenerError["code"],
      message: string,
    ): PullRequestOpenerError => ({
      code,
      message: message + outcome,
      ...(summary.status !== undefined ? { status: summary.status } : {}),
      ...(summary.detail !== undefined ? { detail: summary.detail } : {}),
    });

    // The reactive workflow-scope remap carries a typed code and GitHub's raw
    // status is a misleading 404, so it must be checked before status mapping.
    if (err.code === "workflow-scope-missing") {
      return withSummary(
        "workflow-scope-missing",
        "GitHub rejected this pull request because it adds GitHub Actions " +
          "workflow files and the connected token lacks the 'workflow' " +
          "OAuth scope. Reconnect GitHub to grant workflow permission, then " +
          "retry.",
      );
    }
    if (err.status === 401) {
      return withSummary(
        "auth-failed",
        "The GitHub connection is no longer valid. Reconnect GitHub and " +
          "retry.",
      );
    }
    if (err.status === 403) {
      // GitHub reports secondary rate limiting as 403, not 429. This
      // substring check only REFINES an already-denied outcome into a more
      // actionable message — no authorization decision depends on it.
      if (/rate limit|abuse detection/i.test(summary.detail ?? "")) {
        return withSummary(
          "rate-limit",
          "GitHub is rate-limiting this account. Wait a few minutes and " +
            "retry.",
        );
      }
      return withSummary(
        "auth-failed",
        "GitHub refused the request with the connected credential. " +
          "Reconnect GitHub and retry.",
      );
    }
    if (err.status === 404) {
      // A 404 on a `repo`-scoped token means gone or never visible — GitHub
      // returns 404 rather than 403 for repositories a token cannot see.
      return withSummary(
        "repo-unavailable",
        "That repository could not be found with the connected GitHub " +
          "account. It may have been renamed, deleted, or made private to " +
          "another account.",
      );
    }
    if (err.status === 409 || err.status === 422) {
      return withSummary(
        "conflict",
        "GitHub rejected the write as conflicting with the repository's " +
          "current state. Nothing was overwritten; retry to build on the " +
          "latest history.",
      );
    }
    if (err.status === 429) {
      return withSummary(
        "rate-limit",
        "GitHub is rate-limiting this account. Wait a few minutes and " +
          "retry.",
      );
    }
    return withSummary("unknown", "GitHub rejected the request.");
  }
  if (err instanceof TypeError) {
    // `fetch` reports transport failures (DNS, TLS, connection reset) as
    // TypeError. Whether anything reached GitHub is exactly what
    // `writeOutcomeSentence` refuses to guess at.
    return {
      code: "network",
      message:
        "Could not reach GitHub. Check connectivity and retry." + outcome,
    };
  }
  return {
    code: "unknown",
    message:
      "Opening the pull request failed for an unexpected reason." + outcome,
  };
}

/**
 * Sanitize the caller's decorative slug down to `[a-z0-9-]`. Sanitize rather
 * than reject because the result is confined to a namespace we own and the
 * value carries no authority — but the sanitizer is total: anything that does
 * not survive it becomes the default slug.
 */
function sanitizeBranchSlug(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_BRANCH_SLUG;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, "");
  return cleaned.length === 0 ? DEFAULT_BRANCH_SLUG : cleaned;
}

/**
 * Reject any path that could escape the repository root, address git's own
 * metadata, or confuse the tree API. Paths reach GitHub as tree entries, so a
 * `..` segment or a leading `/` is a traversal attempt, not a typo.
 */
function validateFilePath(filePath: unknown): string | null {
  if (typeof filePath !== "string") return "must be a string";
  if (filePath.length === 0) return "must not be empty";
  if (filePath.length > MAX_PATH_LENGTH) {
    return `must be at most ${MAX_PATH_LENGTH} characters`;
  }
  if (filePath.startsWith("/")) return "must be repository-relative";
  if (filePath.endsWith("/")) return "must name a file, not a directory";
  if (filePath.includes("\\")) return "must not contain backslashes";
  // eslint-disable-next-line no-control-regex -- control chars are the check
  if (/[\x00-\x1f\x7f]/.test(filePath)) {
    return "must not contain control characters";
  }
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return "must not contain empty path segments";
    if (segment === "." || segment === "..") {
      return "must not contain '.' or '..' segments";
    }
    if (segment.length > MAX_PATH_SEGMENT_LENGTH) {
      return `path segments must be at most ${MAX_PATH_SEGMENT_LENGTH} characters`;
    }
  }
  // Case-insensitive, and covering the NTFS 8.3 short name. Git's own checkout
  // protections cover these, but the check is one comparison and the failure
  // mode it guards (a tree entry that lands inside `.git/` on a
  // case-insensitive or Windows checkout) is repository takeover, not a typo.
  const firstSegment = (segments[0] ?? "").toLowerCase();
  if (firstSegment === ".git" || firstSegment === "git~1") {
    return "must not write into .git/";
  }
  return null;
}

function invalid(message: string): Result<never, PullRequestOpenerError> {
  return { success: false, error: { code: "invalid-input", message } };
}

/**
 * Validate and normalize everything the caller supplied. Runs entirely before
 * the first network call, so an invalid request is never half-applied.
 */
function validateRequest(
  request: OpenPullRequestRequest,
): Result<ValidatedRequest, PullRequestOpenerError> {
  if (request === null || typeof request !== "object") {
    return invalid("No pull-request request was supplied.");
  }
  const repository = request.repository;
  if (repository === null || typeof repository !== "object") {
    return invalid("A target repository (owner and name) is required.");
  }
  const { owner, repo } = repository;
  if (typeof owner !== "string" || !OWNER_PATTERN.test(owner)) {
    return invalid("The repository owner is not a valid GitHub account name.");
  }
  if (
    typeof repo !== "string" ||
    !REPO_PATTERN.test(repo) ||
    repo === "." ||
    repo === ".."
  ) {
    return invalid(
      "The repository name is not a valid GitHub repository name.",
    );
  }

  const title = typeof request.title === "string" ? request.title.trim() : "";
  if (title.length === 0) return invalid("A pull-request title is required.");
  if (title.length > MAX_TITLE_LENGTH) {
    return invalid(
      `The pull-request title must be at most ${MAX_TITLE_LENGTH} characters.`,
    );
  }

  const body = typeof request.body === "string" ? request.body : "";
  if (body.length > MAX_BODY_LENGTH) {
    return invalid(
      `The pull-request body must be at most ${MAX_BODY_LENGTH} characters.`,
    );
  }

  const rawCommitMessage =
    typeof request.commitMessage === "string"
      ? request.commitMessage.trim()
      : "";
  const commitMessage = rawCommitMessage.length > 0 ? rawCommitMessage : title;
  if (commitMessage.length > MAX_COMMIT_MESSAGE_LENGTH) {
    return invalid(
      `The commit message must be at most ${MAX_COMMIT_MESSAGE_LENGTH} characters.`,
    );
  }

  if (!Array.isArray(request.files) || request.files.length === 0) {
    return invalid("At least one file is required to open a pull request.");
  }
  if (request.files.length > MAX_FILES) {
    return invalid(
      `A pull request may carry at most ${MAX_FILES} files (received ${request.files.length}).`,
    );
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const files: PullRequestFile[] = [];
  for (const file of request.files) {
    if (file === null || typeof file !== "object") {
      return invalid("Each file must be an object with a path and content.");
    }
    const pathProblem = validateFilePath(file.path);
    if (pathProblem !== null) {
      // The offending path is echoed back because the caller supplied it and
      // needs to know which entry was rejected; it is never sent to GitHub.
      return invalid(
        `Invalid file path ${JSON.stringify(String(file.path)).slice(0, 120)}: ${pathProblem}.`,
      );
    }
    const filePath = file.path;
    if (seen.has(filePath)) {
      return invalid(`Duplicate file path in the pull request: ${filePath}.`);
    }
    seen.add(filePath);

    if (typeof file.content !== "string") {
      return invalid(`File ${filePath} must have string content.`);
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      return invalid(
        `File ${filePath} is ${bytes} bytes; the limit is ${MAX_FILE_BYTES}.`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return invalid(
        `The pull request exceeds the ${MAX_TOTAL_BYTES}-byte total size limit.`,
      );
    }
    files.push({ path: filePath, content: file.content });
  }

  return {
    success: true,
    value: {
      owner,
      repo,
      title,
      body,
      commitMessage,
      files,
      branchSlug: sanitizeBranchSlug(request.branchSlug),
    },
  };
}
