import { MAX_PROJECT_NAME_CHARS } from "@/lib/project-scan/limits";

/**
 * S2a — the pure half of the Tier-B repository-entry form (F-16, BF-5.3).
 *
 * ## This is NOT a mirror of the server's parser, on purpose
 *
 * `app/lib/project-scan/clone.ts` owns the real grammar: an owner pattern, a
 * repository pattern, a ref pattern, a host allow-set, userinfo and port
 * checks, and a re-constructed clone URL. It is the single trust boundary, and
 * it cannot be imported here — it pulls in `node:child_process`, so it can
 * never enter a client bundle.
 *
 * Copying it would therefore create a SECOND grammar that looks authoritative,
 * drifts silently, and — in the direction that matters — starts rejecting
 * repositories the server would happily clone. That is the failure mode
 * `looksLikeZip` in `BrownfieldImportPage.tsx` documents for the Tier-A form:
 * a client predicate must be asked the client's question, not the server's.
 *
 * The client's question here is only: **is there any point sending this?** So
 * this module refuses exactly what a round trip could not possibly fix — an
 * empty box, a non-GitHub host, something that is not two path segments — and
 * defers everything finer (hyphen placement, reserved names, length limits at
 * the margin) to the route, whose rejection arrives with a machine-readable
 * `reason` that `scan-stream.ts` turns into a precise hint. Erring towards
 * ACCEPTING is the correct bias: a false accept costs one request that comes
 * back with better copy than this file could write; a false reject is a
 * repository the product refuses to scan for no reason.
 */

/** What the box is showing, from the form's point of view. */
export type RepoInputVerdict =
  /** Nothing typed yet. Not an error — the submit button is simply inert. */
  | "empty"
  /** Recognisably a GitHub repository reference. Send it. */
  | "usable"
  /** A URL that is not github.com. A round trip cannot fix this. */
  | "not-github"
  /** Text that is not two path segments. A round trip cannot fix this either. */
  | "unparsed";

export interface RepoInputReading {
  readonly verdict: RepoInputVerdict;
  /** Owner as typed, when two segments were found. Display only. */
  readonly owner: string | null;
  /** Repository as typed, `.git` suffix removed. Display only. */
  readonly repo: string | null;
  /**
   * The advisory sentence for the form, or `null` when there is nothing to
   * say. Never a verdict about a reference the SERVER has not seen yet.
   */
  readonly advisory: string | null;
}

const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "www.github.com",
]);

/**
 * The same 2048-character bound the route applies before it parses. Present
 * for the same reason: `URL` on a pasted megabyte is work worth not doing.
 */
const MAX_INPUT_CHARS = 2048;

const ADVISORIES: Readonly<Record<RepoInputVerdict, string | null>> = {
  empty: null,
  usable: null,
  "not-github":
    "Only github.com repositories can be scanned here. Paste a github.com URL, or type `owner/repo`.",
  unparsed:
    "Type the repository as `owner/repo`, or paste its full github.com URL.",
};

function reading(
  verdict: RepoInputVerdict,
  owner: string | null = null,
  repo: string | null = null,
): RepoInputReading {
  return { verdict, owner, repo, advisory: ADVISORIES[verdict] };
}

/** Strip a trailing `.git`, which is legal to paste and never part of the name. */
function trimGitSuffix(segment: string): string {
  return segment.endsWith(".git") ? segment.slice(0, -4) : segment;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Read what the user typed. Advisory only — see the module docblock.
 *
 * Accepts the `owner/repo` shorthand and an `https://github.com/owner/repo`
 * URL, the same two shapes the route accepts. Extra path segments (a `/tree/`
 * deep link, the trailing slash GitHub's own copy button leaves) are tolerated
 * here and the first two are read, because the alternative is telling someone
 * their correct URL is wrong.
 */
export function readRepoInput(raw: string): RepoInputReading {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return reading("empty");
  if (trimmed.length > MAX_INPUT_CHARS) return reading("unparsed");

  let segments: string[];
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    } catch {
      return reading("unparsed");
    }
    // Exact membership, never `endsWith` — `github.com.evil.tld` must not pass
    // a check the server would fail. `URL` has already lowercased and
    // punycoded the host, so a homoglyph domain is not in the set either.
    if (!GITHUB_HOSTS.has(url.hostname)) return reading("not-github");
    if (url.username.length > 0 || url.password.length > 0) {
      return reading("not-github");
    }
    segments = splitPath(url.pathname);
  } else {
    if (trimmed.includes("@")) {
      // `git@github.com:owner/repo.git`. The route rejects the SSH form
      // outright, so saying so saves a round trip that could only fail.
      return reading("not-github");
    }
    // A shorthand is a path, not a sentence and not a URL fragment.
    if (/[\s:?#]/.test(trimmed)) return reading("unparsed");
    segments = splitPath(trimmed);

    // A scheme-less paste of `github.com/owner/repo` is extremely common, and
    // so is the same paste from a DIFFERENT host. Both are told apart by one
    // fact borrowed from the server's grammar rather than by re-implementing
    // it: a GitHub account name can never contain a dot, so a first segment
    // that does is a hostname, not an owner.
    if (segments.length > 0 && segments[0].includes(".")) {
      if (!GITHUB_HOSTS.has(segments[0].toLowerCase())) {
        return reading("not-github");
      }
      segments = segments.slice(1);
    }
  }

  if (segments.length < 2) return reading("unparsed");

  const owner = segments[0];
  const repo = trimGitSuffix(segments[1]);
  if (owner.length === 0 || repo.length === 0) return reading("unparsed");

  return reading("usable", owner, repo);
}

/** Canonical `owner/repo` for the request body, or `null` when unusable. */
export function toRepoReference(input: string): string | null {
  const read = readRepoInput(input);
  if (read.verdict !== "usable" || read.owner === null || read.repo === null) {
    return null;
  }
  return `${read.owner}/${read.repo}`;
}

/**
 * A project name derived from the repository name, used ONLY to prefill an
 * untouched field. The user always sees it and can always overwrite it.
 *
 * Clamped to the route's own `MAX_PROJECT_NAME_CHARS`, because a suggestion
 * that is refused on submit is worse than no suggestion.
 */
export function suggestProjectName(input: string): string {
  const read = readRepoInput(input);
  if (read.repo === null) return "";
  return read.repo.slice(0, MAX_PROJECT_NAME_CHARS);
}

/** Why the submit button is inert, or `null` when it is not. */
export function describeSubmitBlocker(
  repoInput: string,
  projectName: string,
): string | null {
  const read = readRepoInput(repoInput);
  if (read.verdict === "empty") return "Enter a repository to scan.";
  if (read.verdict !== "usable") return read.advisory;
  const name = projectName.trim();
  if (name.length === 0) return "Give the project a name.";
  if (name.length > MAX_PROJECT_NAME_CHARS) {
    return `The project name must be ${MAX_PROJECT_NAME_CHARS} characters or fewer.`;
  }
  return null;
}
