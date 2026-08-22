import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { scanWorkspaceBaseDir } from "./workspace-root";

/**
 * Bounded shallow clone of a PUBLIC GitHub repository (F-09, packet BF-5.2).
 *
 * This module is the only place in the product where user-supplied text causes
 * the server to reach out to the network and then run a subprocess, so every
 * input is treated as hostile. The design rules, in the order an attacker meets
 * them:
 *
 * 1. **The input is a repository reference, not a URL to fetch.** Nothing the
 *    caller types is ever handed to `git` or `fetch` as-is. The reference is
 *    parsed down to `{ owner, repo }`, each validated against GitHub's own
 *    account/repository grammar, and the clone URL is then *re-constructed*
 *    from a hard-coded literal origin. There is no code path that can produce
 *    a request to a host other than `github.com` / `api.github.com`.
 * 2. **Argv only, never a shell string.** `spawn` is called with an argument
 *    array and `shell` is left at its default `false`. Combined with the
 *    charset checks (no leading `-`, no `=`) and a terminating `--`, no input
 *    can become a `git` flag.
 * 3. **The preflight is an optimization; the clone is the enforcement.** The
 *    GitHub API `size` field lets an obviously oversized repository be refused
 *    without spending any bandwidth, but it is advisory (see
 *    {@link preflightRepository}). The clone is therefore *also* metered while
 *    it runs and killed the moment it crosses the on-disk budget.
 * 4. **Nothing outlives the call.** The clone runs in its own process group,
 *    gets SIGTERM then SIGKILL, and the workspace is removed by the caller's
 *    `finally`.
 * 5. **No credentials, ever.** The child's environment is built from scratch —
 *    it is not `process.env` — so no token, secret, or proxy setting in the
 *    server environment can reach `git`, and no credential helper, askpass
 *    program, or user/system gitconfig is consulted.
 *
 * Kept deliberately free of Next.js types so it is unit-testable as a plain
 * module: every effect (`fetch`, `spawn`, the clock) is injectable.
 */

/** Env var name for the kill switch. Default OFF — see {@link isGitHubScanEnabled}. */
export const GITHUB_SCAN_ENV_VAR = "BROWNFIELD_GITHUB_SCAN";

/**
 * The only values that switch the feature ON. Mirrors the BF-6.3 idiom in
 * `packages/external-integration/.../pull-request-opener.port.ts`: an allow-set
 * rather than a deny-check, so unset, empty, `"0"`, `"no"`, `"disabled"`, a
 * typo, or any other value all leave the feature off.
 */
const ENABLING_VALUES: ReadonlySet<string> = new Set(["1", "true"]);

/**
 * Pure predicate for the kill switch. Exported so the route and any future
 * caller ask the same question, and so default-off is directly testable
 * without mutating the real process environment.
 */
export function isGitHubScanEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[GITHUB_SCAN_ENV_VAR];
  if (typeof raw !== "string") return false;
  return ENABLING_VALUES.has(raw.trim().toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/**
 * Preflight refusal threshold, applied to the GitHub API's `size` field.
 *
 * Lower than {@link MAX_CLONE_DISK_BYTES} on purpose: `size` describes the
 * repository, while the clone materializes a pack *and* a checked-out working
 * tree, so the same repository costs roughly two to three times this on disk.
 */
export const MAX_REPO_SIZE_BYTES = 128 * 1024 * 1024;

/**
 * Hard on-disk ceiling for the clone workspace, enforced WHILE the clone runs.
 * Three times {@link MAX_REPO_SIZE_BYTES} to leave room for pack + checkout of
 * a repository that passed the preflight honestly.
 */
export const MAX_CLONE_DISK_BYTES = 384 * 1024 * 1024;

/**
 * Entry ceiling for the workspace, enforced by the same sampler. Bounds inode
 * consumption, and bounds the *sampler itself* — without it, a repository with
 * millions of tiny files turns the size walk into the denial of service it is
 * supposed to prevent.
 */
export const MAX_CLONE_ENTRIES = 120_000;

/** Wall-clock budget for the clone subprocess. */
export const CLONE_TIMEOUT_MS = 60_000;

/** Timeout for the GitHub API preflight request. */
export const PREFLIGHT_TIMEOUT_MS = 10_000;

/** How often the workspace is measured while the clone runs. */
export const CLONE_SAMPLE_INTERVAL_MS = 400;

/** Grace period between SIGTERM and SIGKILL for the clone process group. */
export const CLONE_SIGKILL_GRACE_MS = 3_000;

/** Cap on the preflight response body. GitHub's repo JSON is a few KB. */
const MAX_PREFLIGHT_BODY_BYTES = 1024 * 1024;

/** Progress lines forwarded to the client are truncated to this length. */
const MAX_PROGRESS_LINE_CHARS = 200;

/* ------------------------------------------------------------------ */
/* Reference parsing                                                   */
/* ------------------------------------------------------------------ */

/**
 * GitHub account-name grammar: alphanumerics with single interior hyphens,
 * 39 characters maximum. Same pattern BF-6.3 validates PR targets with.
 *
 * Note what it excludes and why each matters here: a leading `-` (which would
 * make the owner look like a `git` flag), `.` and `/` (which would let
 * `../`-style segments or an extra path component into the reconstructed URL),
 * `@` and `:` (userinfo and port), and every non-ASCII character (so a
 * Unicode homoglyph can never reach the URL builder).
 */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * GitHub repository-name grammar. Dots are legal (`.github`, `my.repo`), so
 * `.` cannot simply be banned; instead the standalone `.`/`..` names and any
 * `..` sequence are rejected explicitly below, and a leading `-` — the
 * argument-injection case — is excluded by the pattern itself.
 */
const REPO_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$/;

/**
 * Conservative git ref grammar for the optional branch/tag.
 *
 * Deliberately narrower than `git check-ref-format`: no leading `-` (flag
 * injection), no `=` (so `--upload-pack=…`-shaped text cannot appear even if a
 * future edit interpolated it), no `..`, no whitespace, no `~^:?*[\`, and
 * ASCII only.
 */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** The one origin this module will ever clone from. Never derived from input. */
const GITHUB_ORIGIN = "https://github.com";

/** The one API origin this module will ever call. Never derived from input. */
const GITHUB_API_ORIGIN = "https://api.github.com";

/** Hostnames accepted in a pasted repository URL, matched by EXACT equality. */
const ALLOWED_URL_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "www.github.com",
]);

export interface RepoReference {
  readonly owner: string;
  readonly repo: string;
  /** Branch or tag, or `null` to let the host's default branch be used. */
  readonly ref: string | null;
}

export type RepoReferenceRejection =
  | "missing"
  | "not-github"
  | "malformed"
  | "bad-owner"
  | "bad-repo"
  | "bad-ref";

export type ParseRepoReferenceResult =
  | { readonly ok: true; readonly reference: RepoReference }
  | { readonly ok: false; readonly reason: RepoReferenceRejection };

/**
 * Parse a user-supplied repository reference into `{ owner, repo, ref }`.
 *
 * Accepts either the `owner/repo` shorthand or an `https://github.com/owner/repo`
 * URL, and NOTHING else. In particular every one of these is rejected, each by
 * a named check rather than as a side effect:
 *
 * - a non-GitHub host (`https://evil.tld/a/b`) — host allow-set;
 * - a host that merely *ends with* `github.com` (`evilgithub.com`,
 *   `github.com.evil.tld`, `github.com.`) — exact-equality membership, never
 *   `endsWith`;
 * - userinfo smuggling (`https://github.com@evil.tld/a/b`,
 *   `https://user:pass@github.com/a/b`) — `username`/`password` must be empty,
 *   and in the first case the parsed host is `evil.tld` anyway;
 * - a non-`https` scheme, including `ssh://`, `git://`, `file://`, `http://`
 *   and `javascript:` — protocol allow-set;
 * - `git@github.com:owner/repo.git` — has no parseable scheme and contains
 *   `@`, so it never reaches the shorthand branch;
 * - a non-default port (`https://github.com:8080/a/b`) — port must be empty;
 * - Unicode/IDN homoglyphs (`https://githüb.com/a/b`, Cyrillic look-alikes) —
 *   WHATWG `URL` normalizes the host to punycode (`xn--…`), which is not in the
 *   allow-set, and the owner/repo patterns are ASCII-only besides;
 * - `../` in either segment — the path must be exactly two segments and both
 *   patterns exclude `/`, with `.`/`..`/`..`-containing names refused by name.
 *
 * `rawRef` is optional; an empty/absent ref means "use the default branch",
 * which is resolved from the API preflight rather than guessed.
 */
export function parseRepoReference(
  rawReference: unknown,
  rawRef?: unknown,
): ParseRepoReferenceResult {
  if (typeof rawReference !== "string") return { ok: false, reason: "missing" };
  const trimmed = rawReference.trim();
  if (trimmed.length === 0) return { ok: false, reason: "missing" };
  // A 2048-char bound before any parsing: `URL` on a megabyte of text is
  // itself work an anonymous caller should not be able to command.
  if (trimmed.length > 2048) return { ok: false, reason: "malformed" };

  const ref = parseGitRef(rawRef);
  if (ref === undefined) return { ok: false, reason: "bad-ref" };

  const segments = extractOwnerRepoSegments(trimmed);
  if (segments === null) return { ok: false, reason: "not-github" };
  if (segments === "malformed") return { ok: false, reason: "malformed" };

  const { owner, repo } = segments;
  if (!OWNER_PATTERN.test(owner)) return { ok: false, reason: "bad-owner" };
  if (!isSafeRepoName(repo)) return { ok: false, reason: "bad-repo" };

  return { ok: true, reference: { owner, repo, ref } };
}

function isSafeRepoName(repo: string): boolean {
  if (repo === "." || repo === "..") return false;
  if (repo.includes("..")) return false;
  return REPO_PATTERN.test(repo);
}

/**
 * `undefined` = invalid (caller rejects), `null` = absent (use default branch).
 */
function parseGitRef(rawRef: unknown): string | null | undefined {
  if (rawRef === undefined || rawRef === null) return null;
  if (typeof rawRef !== "string") return undefined;
  const trimmed = rawRef.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("..")) return undefined;
  return REF_PATTERN.test(trimmed) ? trimmed : undefined;
}

type SegmentResult = { owner: string; repo: string } | null | "malformed";

/**
 * Pull the two path segments out of a shorthand or a URL.
 *
 * `null` means "this is not a github.com reference" (kept distinct from
 * `"malformed"` so the caller can report the more useful of the two, and so a
 * future reader cannot collapse the host check into the shape check).
 */
function extractOwnerRepoSegments(input: string): SegmentResult {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) || input.startsWith("//")) {
    return segmentsFromUrl(input);
  }
  // Shorthand. `@` and `:` are excluded here so `git@github.com:owner/repo`
  // cannot slip through as a two-segment path.
  if (input.includes("@") || input.includes(":")) return null;
  const parts = input.replace(/\/+$/, "").split("/");
  if (parts.length !== 2) return "malformed";
  return { owner: parts[0], repo: stripDotGit(parts[1]) };
}

function segmentsFromUrl(input: string): SegmentResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return "malformed";
  }
  // Scheme allow-set. `ssh:`, `git:`, `file:`, `http:`, `data:` and everything
  // else fail here — the check is membership, not a blocklist.
  if (url.protocol !== "https:") return null;
  // Userinfo is never legitimate on a public clone URL and is the classic
  // way to make a hostile host look like a trusted one in a URL bar.
  if (url.username !== "" || url.password !== "") return null;
  // A non-default port would still be github.com, but nothing legitimate uses
  // one and allowing it widens what the server may connect to.
  if (url.port !== "") return null;
  // EXACT equality against the allow-set. `endsWith("github.com")` would admit
  // `evilgithub.com`; a prefix check would admit `github.com.evil.tld`. The
  // WHATWG parser has already lower-cased and punycoded the host, so an IDN
  // homoglyph arrives as `xn--…` and fails membership.
  if (!ALLOWED_URL_HOSTS.has(url.hostname)) return null;

  const parts = url.pathname.split("/").filter((segment) => segment !== "");
  if (parts.length !== 2) return "malformed";
  return { owner: parts[0], repo: stripDotGit(parts[1]) };
}

function stripDotGit(segment: string): string {
  return segment.endsWith(".git") ? segment.slice(0, -4) : segment;
}

/** The clone URL. Built from a literal origin plus two validated segments. */
export function cloneUrlFor(reference: RepoReference): string {
  return `${GITHUB_ORIGIN}/${reference.owner}/${reference.repo}.git`;
}

/* ------------------------------------------------------------------ */
/* Error codes                                                         */
/* ------------------------------------------------------------------ */

/**
 * The subset of the F-35 taxonomy this module can produce. No prose is
 * invented here: a failure is a code plus a short `detail` that exists for the
 * SERVER LOG only and is never part of the client payload.
 */
export type CloneErrorCode = "clone_failed" | "repo_too_large" | "timeout";

export interface CloneFailure {
  readonly ok: false;
  readonly code: CloneErrorCode;
  /** Log-only. Callers must not echo this to a client. */
  readonly detail: string;
}

/* ------------------------------------------------------------------ */
/* Preflight                                                           */
/* ------------------------------------------------------------------ */

export interface PreflightSuccess {
  readonly ok: true;
  /** `size` from the API, converted from KB to bytes. */
  readonly sizeBytes: number;
  readonly defaultBranch: string | null;
}

export type PreflightResult = PreflightSuccess | CloneFailure;

export interface PreflightDeps {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxRepoSizeBytes?: number;
}

/**
 * Ask the GitHub REST API how big the repository is before spending any
 * bandwidth on it.
 *
 * **`size` is in KILOBYTES, and it is advisory.** Three known gaps, none of
 * which this function can close and none of which it pretends to:
 *
 * - it does not include Git LFS objects, so an LFS-heavy repository reports
 *   small and clones large. The clone disables LFS smudge/process filters
 *   entirely (see {@link cloneRepository}), so LFS pointers are fetched as the
 *   few-hundred-byte text files they are and the payload never arrives;
 * - it is a periodically-recomputed server-side figure, so a repository that
 *   grew since the last recomputation — or a brand-new one, which reports `0` —
 *   under-reports;
 * - it describes the repository, not the checkout: a well-packed repository
 *   expands on disk.
 *
 * That is exactly why this is an optimization and not the enforcement. The
 * during-clone sampler in {@link cloneRepository} is what actually bounds the
 * server, and it is unconditional — it runs even when the preflight said the
 * repository was tiny.
 *
 * No `Authorization` header is sent, by construction: the request is built with
 * a literal header set and there is no parameter through which a token could be
 * supplied. A private repository therefore answers 404 exactly as it would to
 * any anonymous client, and the anonymous rate limit is what applies.
 */
export async function preflightRepository(
  reference: RepoReference,
  deps: PreflightDeps = {},
): Promise<PreflightResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  const maxRepoSizeBytes = deps.maxRepoSizeBytes ?? MAX_REPO_SIZE_BYTES;

  // Origin is a literal; only the two validated segments vary, and both are
  // percent-encoded anyway so a hypothetical escape could not add a path.
  const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(
    reference.owner,
  )}/${encodeURIComponent(reference.repo)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      // `manual`, not `follow`. A followed redirect is a request to a host the
      // response body chose, which is precisely the SSRF shape this packet is
      // about. The cost is that a RENAMED repository is refused rather than
      // silently followed to its new name — the user retypes the current name.
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "hexagen-brownfield-scan",
      },
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      code: aborted ? "timeout" : "clone_failed",
      detail: aborted
        ? "preflight timed out"
        : `preflight request failed: ${messageOf(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      code: "clone_failed",
      detail: `preflight redirected (${response.status})`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "clone_failed",
      detail: `preflight status ${response.status}`,
    };
  }

  const body = await readCappedText(response);
  if (body === null) {
    return {
      ok: false,
      code: "clone_failed",
      detail: "preflight body too large",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      code: "clone_failed",
      detail: "preflight body not JSON",
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      code: "clone_failed",
      detail: "preflight body not an object",
    };
  }
  const record = parsed as Record<string, unknown>;

  // Belt and braces: without a token a private repo 404s, so this branch is
  // unreachable today. It stays because "we send no token" is a property of
  // the code above, and a future edit that adds one must not silently turn
  // this into a private-repo reader.
  if (record.private === true) {
    return { ok: false, code: "clone_failed", detail: "repository is private" };
  }

  const rawSize = record.size;
  if (typeof rawSize !== "number" || !Number.isFinite(rawSize) || rawSize < 0) {
    // Absent or nonsense `size` is NOT treated as zero. Fail closed: the whole
    // point of the preflight is to refuse before spending bandwidth, and a
    // missing figure means it cannot do its job.
    return {
      ok: false,
      code: "clone_failed",
      detail: "preflight size missing",
    };
  }
  // KB -> bytes. Getting this wrong by 1024x is the obvious way to turn a
  // 128 MiB cap into a 128 GiB one.
  const sizeBytes = rawSize * 1024;
  if (sizeBytes > maxRepoSizeBytes) {
    return {
      ok: false,
      code: "repo_too_large",
      detail: `preflight size ${sizeBytes} > ${maxRepoSizeBytes}`,
    };
  }

  const defaultBranch =
    typeof record.default_branch === "string" &&
    REF_PATTERN.test(record.default_branch)
      ? record.default_branch
      : null;

  return { ok: true, sizeBytes, defaultBranch };
}

/** Read a response body through a byte counter, or `null` if it exceeds the cap. */
async function readCappedText(response: Response): Promise<string | null> {
  const stream = response.body;
  if (stream === null) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_PREFLIGHT_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export interface CloneWorkspace {
  /** Directory the repository is cloned into. */
  readonly repoDir: string;
  /** `HOME` for the child, so no real user gitconfig is ever read. */
  readonly homeDir: string;
  /** Idempotent recursive delete. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/**
 * Create the throwaway workspace. `repoDir` and `homeDir` are siblings under
 * one `mkdtemp` root so a single `rm -rf` removes both, and neither path is
 * derived from user input.
 *
 * `baseDir` defaults to {@link scanWorkspaceBaseDir}, NOT to `os.tmpdir()`:
 * `hexagen scan` locates `hexagen-lint` by walking UP from the directory it is
 * pointed at, and that walk only reaches the application's `node_modules` when
 * the workspace lives under the application root. See `workspace-root.ts` for
 * the walk, path by path.
 *
 * Because that base is outside the OS temp directory, nothing on the host
 * sweeps a leaked workspace — `/tmp` gets cleaned, `<appRoot>/.scan-workspaces`
 * does not. `cleanup()` is therefore not a courtesy; every caller must run it in
 * a `finally`.
 */
export async function createCloneWorkspace(
  baseDir: string = scanWorkspaceBaseDir(),
): Promise<CloneWorkspace> {
  const root = await mkdtemp(path.join(baseDir, "hexagen-clone-"));
  const homeDir = path.join(root, "home");
  // Materialize HOME so git has a real (and empty) one. `repo` is deliberately
  // NOT created — `git clone` makes it, and a pre-existing directory is one
  // more thing that could be non-empty.
  await mkdir(homeDir, { recursive: true });
  let removed = false;
  return {
    repoDir: path.join(root, "repo"),
    homeDir,
    async cleanup() {
      if (removed) return;
      removed = true;
      await rm(root, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------ */
/* Clone                                                               */
/* ------------------------------------------------------------------ */

export interface CloneProgress {
  /** A sanitized, allow-listed git progress line. */
  readonly line: string;
  /**
   * Bytes received so far as REPORTED BY GIT, or `null` when the line carries
   * no byte figure. Never a percentage and never interpolated — the contract is
   * "real byte counts or none".
   */
  readonly receivedBytes: number | null;
}

export interface CloneDeps {
  readonly spawnImpl?: typeof spawn;
  readonly timeoutMs?: number;
  readonly sampleIntervalMs?: number;
  readonly killGraceMs?: number;
  readonly maxDiskBytes?: number;
  readonly maxEntries?: number;
  /** Overridable for tests; production measures the real directory. */
  readonly measure?: (dir: string) => Promise<TreeMeasurement>;
  /**
   * Signal delivery. Injected ONLY so a test can assert that the whole process
   * GROUP is signalled (a negative pid) without a fake pid causing the test
   * runner to signal a real, unrelated process group. Production is
   * `process.kill`.
   */
  readonly killImpl?: (pid: number, signal: NodeJS.Signals) => void;
}

export interface CloneInput {
  readonly reference: RepoReference;
  readonly workspace: CloneWorkspace;
  readonly onProgress?: (progress: CloneProgress) => void;
  /** Aborts the clone (client disconnect, or the route's own budget). */
  readonly signal?: AbortSignal;
  readonly deps?: CloneDeps;
}

export type CloneResult =
  | { readonly ok: true; readonly durationMs: number }
  | CloneFailure;

/**
 * Shallow-clone the reference into `workspace.repoDir`, bounded on every axis.
 *
 * What bounds what:
 *
 * - **Depth/refs.** `--depth 1 --single-branch --no-tags` fetches one commit of
 *   one branch. `--no-recurse-submodules` (plus `submodule.recurse=false`)
 *   keeps a `.gitmodules` file from turning into a second, uncontrolled fetch
 *   of an arbitrary URL — the submodule URL is attacker-chosen content inside
 *   the repository, and is the one place where "we only ever talk to
 *   github.com" would otherwise stop being true.
 * - **Disk.** A sampler measures the workspace every
 *   {@link CLONE_SAMPLE_INTERVAL_MS} and kills the process group the first time
 *   it exceeds the byte or entry budget. This is what enforces the size limit;
 *   the API preflight only avoids starting hopeless clones.
 * - **Time.** A wall-clock timer kills the process group at `timeoutMs`.
 * - **Protocol.** `protocol.allow=never` + `protocol.https.allow=always` means
 *   even a redirect or a crafted remote cannot get `git` to speak `file://`,
 *   `ssh://` or `ext::` (the last of which executes a command).
 * - **Credentials.** The environment is constructed, not inherited.
 */
export async function cloneRepository(input: CloneInput): Promise<CloneResult> {
  const deps = input.deps ?? {};
  const spawnImpl = deps.spawnImpl ?? spawn;
  const timeoutMs = deps.timeoutMs ?? CLONE_TIMEOUT_MS;
  const sampleIntervalMs = deps.sampleIntervalMs ?? CLONE_SAMPLE_INTERVAL_MS;
  const killGraceMs = deps.killGraceMs ?? CLONE_SIGKILL_GRACE_MS;
  const maxDiskBytes = deps.maxDiskBytes ?? MAX_CLONE_DISK_BYTES;
  const maxEntries = deps.maxEntries ?? MAX_CLONE_ENTRIES;
  // Bind the SAME budgets into the walker. Left unbound, `measureTree` would
  // early-stop at ITS defaults, so a caller-supplied cap larger than the
  // default would silently never be reached — an under-enforcement trap.
  const measure =
    deps.measure ??
    ((dir: string) => measureTree(dir, { maxBytes: maxDiskBytes, maxEntries }));
  const killImpl =
    deps.killImpl ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });

  const startedAt = Date.now();
  const args = buildCloneArgs(input.reference, input.workspace.repoDir);

  let child: ChildProcess;
  try {
    child = spawnImpl("git", args, {
      // A fresh process group. `git clone` spawns helpers (`git-remote-https`,
      // `git index-pack`, and on some builds a credential or LFS helper);
      // killing only the parent leaves those holding the socket and the disk.
      // `-pid` in `killGroup` signals the whole group.
      detached: process.platform !== "win32",
      // Constructed environment, NOT `process.env`. No GITHUB_TOKEN, no
      // NEXTAUTH_SECRET, no LLM key, no http_proxy, nothing.
      //
      // The cast is only to satisfy Next's augmentation of `ProcessEnv`, which
      // makes `NODE_ENV` required. It widens nothing and adds nothing: the
      // value is still the exact record `cloneEnv` builds. The alternative --
      // typing cloneEnv as ProcessEnv -- would have the compiler asking for
      // host variables back, which is the opposite of the point.
      env: cloneEnv(input.workspace.homeDir) as NodeJS.ProcessEnv,
      // `shell` is left false. Never set it here.
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      ok: false,
      code: "clone_failed",
      detail: `git could not be spawned: ${messageOf(error)}`,
    };
  }

  let outcome: CloneErrorCode | null = null;
  let detail = "";
  let settled = false;
  let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

  const killGroup = (signal: NodeJS.Signals) => {
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        // Negative pid = the whole process group created by `detached: true`.
        killImpl(-pid, signal);
      }
    } catch {
      // Already gone, or never started. Nothing to do.
    }
  };

  const fail = (code: CloneErrorCode, why: string) => {
    if (settled) return;
    settled = true;
    outcome = code;
    detail = why;
    // SIGTERM first so git can unlink its temp pack, SIGKILL after a grace
    // period so a wedged or signal-ignoring child cannot outlive the request.
    killGroup("SIGTERM");
    sigkillTimer = setTimeout(() => killGroup("SIGKILL"), killGraceMs);
    // Do not hold the event loop open on the grace timer. Cast because the
    // DOM `setTimeout` overload types this as `number`, which has no `unref`.
    (sigkillTimer as unknown as { unref?: () => void }).unref?.();
  };

  const timeoutTimer = setTimeout(
    () => fail("timeout", `clone exceeded ${timeoutMs}ms`),
    timeoutMs,
  );

  const onAbort = () => fail("clone_failed", "clone aborted by caller");
  if (input.signal) {
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener("abort", onAbort, { once: true });
  }

  // Byte figures parsed out of git's own progress output. Cheaper than a disk
  // walk and updated continuously, so it catches a fast transfer between two
  // samples; the sampler remains the authority because this can be absent.
  let reportedBytes = 0;
  const stderrLines = createLineSplitter((line) => {
    const parsed = parseProgressLine(line);
    if (parsed === null) return;
    if (parsed.receivedBytes !== null) {
      reportedBytes = Math.max(reportedBytes, parsed.receivedBytes);
      if (reportedBytes > maxDiskBytes) {
        fail(
          "repo_too_large",
          `git reported ${reportedBytes} bytes received > ${maxDiskBytes}`,
        );
        return;
      }
    }
    input.onProgress?.(parsed);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => stderrLines(String(chunk)));
  // stdout is drained and discarded. An unread pipe fills and blocks the child.
  child.stdout?.resume();

  const sampler = setInterval(() => {
    void (async () => {
      if (settled) return;
      let measurement: TreeMeasurement;
      try {
        measurement = await measure(input.workspace.repoDir);
      } catch {
        return; // The directory may not exist yet; the next tick retries.
      }
      if (settled) return;
      if (measurement.entries > maxEntries) {
        fail(
          "repo_too_large",
          `workspace entries ${measurement.entries} > ${maxEntries}`,
        );
        return;
      }
      if (measurement.bytes > maxDiskBytes) {
        fail(
          "repo_too_large",
          `workspace bytes ${measurement.bytes} > ${maxDiskBytes}`,
        );
      }
    })();
  }, sampleIntervalMs);
  (sampler as unknown as { unref?: () => void }).unref?.();

  const exit = await new Promise<{ code: number | null; error: Error | null }>(
    (resolve) => {
      child.once("error", (error) => resolve({ code: null, error }));
      child.once("close", (code) => resolve({ code, error: null }));
    },
  );

  clearTimeout(timeoutTimer);
  clearInterval(sampler);
  if (sigkillTimer) clearTimeout(sigkillTimer);
  input.signal?.removeEventListener("abort", onAbort);
  // Only when we decided to kill. `git` reaps its own helpers on a normal
  // exit, so a happy-path group signal would buy nothing — and signalling a
  // process group whose leader has already been reaped risks hitting a
  // recycled pid. On the kill path a helper that ignored SIGTERM may still
  // hold the socket, and closing that window is worth the (narrow) race.
  if (settled) killGroup("SIGKILL");

  if (outcome !== null) return { ok: false, code: outcome, detail };
  if (exit.error !== null) {
    return {
      ok: false,
      code: "clone_failed",
      detail: `git failed to run: ${exit.error.message}`,
    };
  }
  if (exit.code !== 0) {
    // git's stderr is NOT forwarded. It can contain the workspace path and, in
    // some failure modes, a URL; the client gets a code from the taxonomy.
    return {
      ok: false,
      code: "clone_failed",
      detail: `git exited ${exit.code ?? "null"}`,
    };
  }

  // Final measurement. The sampler is periodic, so a clone that finished
  // between two ticks must still be checked before the tree is handed on.
  try {
    const finalMeasurement = await measure(input.workspace.repoDir);
    if (
      finalMeasurement.bytes > maxDiskBytes ||
      finalMeasurement.entries > maxEntries
    ) {
      return {
        ok: false,
        code: "repo_too_large",
        detail: `final workspace ${finalMeasurement.bytes} bytes / ${finalMeasurement.entries} entries`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      code: "clone_failed",
      detail: `could not measure clone: ${messageOf(error)}`,
    };
  }

  return { ok: true, durationMs: Date.now() - startedAt };
}

/**
 * The full argv. Every element is either a literal or one of the two validated
 * segments; nothing is concatenated into a command string, and `--` terminates
 * option parsing so even a hypothetical `-`-leading value could not become a
 * flag.
 */
export function buildCloneArgs(
  reference: RepoReference,
  destDir: string,
): string[] {
  const config = [
    // No credential helper may run. An empty value resets the list, so a
    // helper configured anywhere else cannot contribute a token.
    "-c",
    "credential.helper=",
    "-c",
    "core.askPass=",
    // Protocol allow-set. Blocks `file://`, `ssh://`, and `ext::<command>`
    // (which git would otherwise execute) no matter how they are reached.
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.https.allow=always",
    // No redirects at all. The canonical owner/repo came from the preflight,
    // so nothing legitimate needs one, and a redirect is a host the response
    // chose rather than one we did.
    "-c",
    "http.followRedirects=false",
    // Git LFS is a SECOND fetch, of URLs the repository controls, of content
    // the API `size` field does not count. Neutralize both filter hooks and
    // make a missing filter non-fatal so pointers land as small text files.
    "-c",
    "filter.lfs.smudge=",
    "-c",
    "filter.lfs.process=",
    "-c",
    "filter.lfs.required=false",
    // Submodules stay unfetched.
    "-c",
    "submodule.recurse=false",
    // No init templates -> no hooks are installed into the clone.
    "-c",
    "init.templateDir=",
    // Symlinks are materialized as plain files, so nothing in the tree can
    // point outside the workspace when the scanner later walks it.
    "-c",
    "core.symlinks=false",
    "-c",
    "core.fsmonitor=",
    "-c",
    "gc.auto=0",
  ];

  const branch = reference.ref === null ? [] : ["--branch", reference.ref];

  return [
    ...config,
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--no-recurse-submodules",
    "--progress",
    ...branch,
    // Terminates option parsing.
    "--",
    cloneUrlFor(reference),
    destDir,
  ];
}

/**
 * The child's entire environment. Built from scratch rather than spread over
 * `process.env`, which is the difference between "we removed the secrets we
 * thought of" and "no secret can be present".
 *
 * `PATH` is the one inherited value — it is needed to find `git` and carries no
 * credential. Everything else is a literal.
 *
 * Returns `Record<string, string>`, deliberately NOT `NodeJS.ProcessEnv`. Next
 * augments `ProcessEnv` with a required `NODE_ENV`, so annotating it that way
 * makes the compiler demand a variable this child has no reason to receive —
 * and the obvious way to silence that is to start adding host env vars back,
 * which is precisely what building the environment from scratch exists to
 * prevent. An exact record type keeps the compiler agreeing with the intent.
 */
function cloneEnv(homeDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    // Point HOME at the throwaway workspace so `~/.gitconfig`,
    // `~/.git-credentials` and `~/.ssh` do not exist for this child.
    HOME: homeDir,
    // Stable, parseable progress output.
    LANG: "C",
    LC_ALL: "C",
    // Never block on an interactive credential prompt.
    GIT_TERMINAL_PROMPT: "0",
    // Ignore /etc/gitconfig and any XDG/global config.
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    // Belt for the `protocol.*` config above, for older git builds.
    GIT_ALLOW_PROTOCOL: "https",
    // Belt for the `filter.lfs.*` config above, if git-lfs is installed.
    GIT_LFS_SKIP_SMUDGE: "1",
  };
}

/* ------------------------------------------------------------------ */
/* Progress parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Progress lines the client may see. An allow-list, not a redaction pass:
 * anything unrecognized is dropped rather than sanitized, so a git message
 * containing the workspace path, a URL, or a hostname cannot reach the browser
 * by being merely unanticipated.
 */
const PROGRESS_PREFIXES: readonly string[] = [
  "remote: Enumerating objects",
  "remote: Counting objects",
  "remote: Compressing objects",
  "remote: Total",
  "Receiving objects",
  "Resolving deltas",
  "Updating files",
  "Cloning into",
];

const BYTES_PATTERN = /([\d.]+)\s*(B|KiB|MiB|GiB)\b/;
const UNIT_MULTIPLIER: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
};

/**
 * Turn one raw git progress line into a client-safe frame, or `null` to drop it.
 *
 * `receivedBytes` comes from git's own figure. When git prints no byte count
 * the field is `null` — this function never divides, estimates, or scales a
 * percentage into a byte total.
 */
export function parseProgressLine(raw: string): CloneProgress | null {
  const line = raw.trim();
  if (line.length === 0) return null;
  if (!PROGRESS_PREFIXES.some((prefix) => line.startsWith(prefix))) return null;

  // `Cloning into '/tmp/hexagen-clone-xxxx/repo'...` names the server's
  // filesystem. The line is useful as a stage marker, the path is not.
  const safeLine = line.startsWith("Cloning into")
    ? "Cloning…"
    : line.slice(0, MAX_PROGRESS_LINE_CHARS);

  const match = BYTES_PATTERN.exec(line);
  let receivedBytes: number | null = null;
  if (match) {
    const value = Number(match[1]);
    const multiplier = UNIT_MULTIPLIER[match[2]];
    if (Number.isFinite(value) && multiplier !== undefined) {
      receivedBytes = Math.round(value * multiplier);
    }
  }
  return { line: safeLine, receivedBytes };
}

/**
 * Split a chunked stream into lines on BOTH `\n` and `\r`: git's progress
 * meter rewrites one line with carriage returns, so a `\n`-only splitter sees
 * a single line grow without bound and emits nothing until the clone ends.
 */
function createLineSplitter(
  onLine: (line: string) => void,
): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    // A pathological remote could emit a very long line with no separator.
    if (buffer.length > 64 * 1024) buffer = buffer.slice(-1024);
    const parts = buffer.split(/[\r\n]/);
    buffer = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  };
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

export interface TreeMeasurement {
  readonly bytes: number;
  readonly entries: number;
}

/**
 * Sum the apparent size of everything under `dir`.
 *
 * `lstat`, not `stat`: a symlink is measured as the link itself and is never
 * followed, so the walk cannot be steered outside the workspace (and cannot be
 * made to loop). The walk stops early once it has already exceeded either
 * budget — there is no reason to finish counting a tree that is already over.
 */
export async function measureTree(
  dir: string,
  limits: { maxBytes?: number; maxEntries?: number } = {},
): Promise<TreeMeasurement> {
  const maxBytes = limits.maxBytes ?? MAX_CLONE_DISK_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_CLONE_ENTRIES;

  let bytes = 0;
  let entries = 0;
  const queue: string[] = [dir];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    let dirEntries;
    try {
      dirEntries = await readdir(current, { withFileTypes: true });
    } catch {
      continue; // Raced with git unlinking a temp pack; not an error.
    }
    for (const entry of dirEntries) {
      entries += 1;
      if (entries > maxEntries) return { bytes, entries };
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      try {
        const stats = await lstat(full);
        bytes += stats.size;
      } catch {
        continue;
      }
      if (bytes > maxBytes) return { bytes, entries };
    }
  }

  return { bytes, entries };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
