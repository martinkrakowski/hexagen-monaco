/**
 * A review thread exactly as the fetch returns it: the node id the resolve
 * mutation takes, and the state the guardrail checks before it posts.
 */
export interface ThreadState {
  readonly id: string;
  readonly isResolved: boolean;
}

/**
 * A thread as fetched, named by the first comment — `mergeGate` refuses an
 * unresolved one by author and excerpt, because an id alone tells the operator
 * nothing about which finding is still open.
 */
export interface ReviewThread extends ThreadState {
  /** Login of the first comment's author, or "unknown" when the API omits one. */
  readonly author: string;
  /** The first comment's body, flattened and shortened enough to recognise. */
  readonly excerpt: string;
  /** The first comment's full body — attribution matches against it, not the excerpt. */
  readonly body: string;
  /** The file the thread is anchored to; "" when the API omits it. */
  readonly path: string;
  /** The line it sits on now, or null for a file-level thread or an outdated one. */
  readonly line: number | null;
  /** The line it sat on when it was written, or null when there is none. */
  readonly originalLine: number | null;
  /** True once the file has changed under the thread. */
  readonly isOutdated: boolean;
}

/** The pull request shape the fetch response is expected to carry. */
export interface PullRequestShape {
  readonly data?: {
    readonly repository?: {
      readonly pullRequest?: {
        readonly id?: string;
        readonly reviewThreads?: {
          readonly pageInfo?: {
            readonly hasNextPage?: boolean;
            readonly endCursor?: string | null;
          };
          readonly nodes?: readonly {
            readonly id: string;
            readonly isResolved: boolean;
            readonly path?: string | null;
            readonly line?: number | null;
            readonly originalLine?: number | null;
            readonly isOutdated?: boolean;
            readonly comments?: {
              readonly nodes?: readonly {
                readonly author?: { readonly login?: string } | null;
                readonly body?: string;
              }[];
            };
          }[];
        };
      };
    };
  };
}

/** What one run decided: the class it verified, or the url it wrote. */
export interface SweepOutcome {
  readonly pr: number;
  readonly classIds: readonly string[];
  readonly commentUrl: string | null;
  readonly resolvedThreadIds: readonly string[];
}

/**
 * The `--post` gate refused: the reasons say which ids were not open
 * threads on the PR. A refusal is the normal answer to a wrong id list —
 * not a crash, and never a partial write.
 */
export class SweepRefusal extends Error {
  readonly reasons: readonly string[];

  constructor(message: string, reasons: readonly string[]) {
    super(message);
    this.name = "SweepRefusal";
    this.reasons = reasons;
  }
}

/**
 * The one repository every `gh` call in this tool is pointed at, as the two
 * halves the GraphQL query declares.
 *
 * Nothing here is hardcoded. The source's `THREADS_QUERY` named one repository
 * in the query text itself, so a packaged `sweep` asked the wrong forge about
 * every PR it was given. The pair comes from the project's overlay and reaches
 * every call: as `$owner`/`$name` variables on the threads query, and as
 * `--repo owner/name` on everything else.
 */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

/** `owner/name` as `--repo` takes it. */
export function repoFlag(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/**
 * Split an `owner/name` into the two halves the query declares, or `undefined`
 * for anything that is not one. `undefined` is what makes the bin refuse: a
 * sweep pointed at a repository nobody named is a sweep pointed at the wrong
 * one.
 */
export function parseRepoRef(repo: string | undefined): RepoRef | undefined {
  if (repo === undefined) return undefined;
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash === repo.length - 1) return undefined;
  if (repo.indexOf("/", slash + 1) !== -1) return undefined;
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);
  if (owner === "" || name === "" || /\s/.test(repo)) return undefined;
  return { owner, name };
}
