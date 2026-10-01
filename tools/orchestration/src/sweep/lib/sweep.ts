import { SweepRefusal } from "./types.js";
import type {
  PullRequestShape,
  RepoRef,
  ReviewThread,
  ThreadState,
} from "./types.js";

/**
 * The GraphQL fetch of the PR's threads. The short `PRVT_` ids that appear
 * in review emails and the web UI name the *discussion*; `sweep`
 * needs the thread node id (`PRRT_`), and it fails on a wrong id with an
 * opaque `Could not resolve to…` — after a comment may already have posted.
 * So the tool verifies every id against this response before it writes, and
 * refuses if one is missing. The `id` of the pull request is fetched with
 * it because `addComment` needs the PR's node id as its subject.
 *
 * The first comment of each thread rides along (`mergeGate` names an open
 * thread by its author and an excerpt), so the merge condition and the sweep
 * read the same connection with one request — a second query over the same
 * pages would be a second parser to keep in step.
 *
 * `owner` and `name` are VARIABLES, passed as `-f owner=… -f name=…` on every
 * call. At the source the repository was a literal in the query text, so a
 * packaged sweep asked the wrong forge about every PR it was handed, and
 * changing which repository it asked about meant editing the query.
 */
export const THREADS_QUERY = `query SweepThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      reviewThreads(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          path
          line
          originalLine
          isOutdated
          comments(first: 1) { nodes { author { login } body } }
        }
      }
    }
  }
}`;

/**
 * The most pages one read will ask for. A page is 100 threads, so this is
 * 20,000 review threads — two orders of magnitude past the largest PR this
 * repo has carried. A read that reaches it is not reading a big PR, it is
 * being handed a cursor that never stops, so it stops itself and says why:
 * the merge script blocks on this loop, and an unbounded read is a hang the
 * operator has to kill.
 */
export const MAX_PAGES = 200;

/** How much of a first comment the refusal quotes before it truncates. */
const EXCERPT_CHARS = 80;

function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_CHARS
    ? flat
    : `${flat.slice(0, EXCERPT_CHARS)}…`;
}

/**
 * What a thrown thing says, whatever it is. `gh` and `JSON.parse` are not the
 * only things that can fail in a run, and a rejection carrying a string is
 * reported as that string rather than as `undefined`.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Everything one paginated read of a PR's threads produced, including what went wrong. */
export interface ThreadsFetch {
  /** Absent when no page carried a readable pull request — see {@link fetchAllThreads}. */
  readonly prId?: string;
  readonly threads: readonly ReviewThread[];
  /**
   * Why a page could not be read. Non-empty means the threads below are a
   * PARTIAL answer, and a caller that decides anything from them is guessing.
   */
  readonly failures: readonly string[];
}

/**
 * Every thread of the PR, across every page, plus every reason a page could
 * not be read.
 *
 * One fetch, one parser, both callers: `sweep`, and `mergeGate`. A page is 100
 * threads, and a PR past 100 is judged on all of them or not at all — a read
 * that stopped at the first page would call a PR with an open thread on page
 * two clean, which is the exact shape of the gap this exists to close.
 *
 * A page that cannot be read is recorded, not treated as empty: without its
 * `pageInfo` there is no knowing whether more pages follow, so the read stops
 * and hands back what it has with a reason. Deciding "no threads" from a
 * partial read is the failure this function's shape makes impossible.
 *
 * The same holds for every other way a read can end early. Only
 * `hasNextPage === false` ends it having seen the whole PR; anything else — a
 * page with no usable `pageInfo`, a `hasNextPage` that is not a boolean, a
 * next page with no cursor to ask for, a cursor already sent, the page bound —
 * is a read that stopped with threads unread, and it is recorded as one.
 */
export async function fetchAllThreads(
  pr: number,
  gh: (args: readonly string[]) => Promise<string>,
  repo: RepoRef,
): Promise<ThreadsFetch> {
  let cursor: string | null = null;
  let prId: string | undefined;
  let pages = 0;
  /** Every cursor this read has asked for — a cursor twice is a loop, not a page. */
  const sentCursors = new Set<string>();
  const threads: ReviewThread[] = [];
  const failures: string[] = [];

  do {
    pages += 1;
    const ghArgs = [
      "api",
      "graphql",
      "-f",
      `query=${THREADS_QUERY}`,
      // `-F`, not `-f`: gh sends `-f number=361` as the *string* "361", which
      // GraphQL refuses for the query's `Int!` variable — every real fetch fails
      // while a stubbed gh sails on. edges.test.ts pins the flag the call makes.
      "-F",
      `number=${pr}`,
      // The repository, as the query's own `String!` variables. Strings, so `-f`.
      "-f",
      `owner=${repo.owner}`,
      "-f",
      `name=${repo.name}`,
    ];
    if (cursor !== null) {
      ghArgs.push("-f", `after=${cursor}`);
    }
    let reply: SweepReply;
    try {
      reply = JSON.parse(await gh(ghArgs)) as SweepReply;
    } catch (error) {
      failures.push(errorText(error));
      break;
    }
    const errorReasons = reply.errors?.map((e) =>
      String(e.message ?? "unknown GraphQL error"),
    );
    if (errorReasons !== undefined && errorReasons.length > 0) {
      failures.push(...errorReasons);
      break;
    }
    const pull = reply.data?.repository?.pullRequest;
    if (pull?.id !== undefined && prId === undefined) {
      prId = pull.id;
    }
    const threadsPage = pull?.reviewThreads;
    if (threadsPage === undefined) {
      // No pull request on the first page is a PR that is not readable — the
      // caller sees no `prId` and says so, which is the truer answer. Losing
      // the PR, or its threads, on a page after one that had them is different:
      // the read has stopped with pages unread, and that is a failure.
      if (prId === undefined) break;
      failures.push(
        `page ${pages} of PR #${pr} carried no reviewThreads — the threads past page ${pages - 1} are unknown, not absent`,
      );
      break;
    }
    for (const n of threadsPage.nodes ?? []) {
      const first = n.comments?.nodes?.[0];
      const body = first?.body ?? "";
      threads.push({
        id: String(n.id),
        isResolved: n.isResolved === true,
        author: first?.author?.login ?? "unknown",
        excerpt: excerptOf(body),
        body,
        path: typeof n.path === "string" ? n.path : "",
        line: typeof n.line === "number" ? n.line : null,
        originalLine:
          typeof n.originalLine === "number" ? n.originalLine : null,
        isOutdated: n.isOutdated === true,
      });
    }
    const pageInfo = threadsPage.pageInfo;
    if (pageInfo === undefined || typeof pageInfo.hasNextPage !== "boolean") {
      // `hasNextPage: "true"` is truthy, which is exactly why truthiness is not
      // the test: a read cannot ask the next page on the strength of a flag it
      // could not understand.
      failures.push(
        `page ${pages} of PR #${pr} carried no usable pageInfo — whether another page follows is unknown, so the read stopped`,
      );
      break;
    }
    if (!pageInfo.hasNextPage) break;
    const next = pageInfo.endCursor;
    if (typeof next !== "string" || next.length === 0) {
      failures.push(
        `page ${pages} of PR #${pr} reported another page with no endCursor — the next page cannot be asked for`,
      );
      break;
    }
    if (sentCursors.has(next)) {
      failures.push(
        `page ${pages} of PR #${pr} handed back cursor ${next}, which this read had already sent — it is looping, not paginating`,
      );
      break;
    }
    sentCursors.add(next);
    cursor = next;
    if (pages >= MAX_PAGES) {
      failures.push(
        `PR #${pr} is still asking for page ${pages + 1} after ${MAX_PAGES} pages — a bounded read is not a complete one`,
      );
      break;
    }
  } while (cursor !== null);

  return {
    ...(prId !== undefined ? { prId } : {}),
    threads,
    failures,
  };
}

/**
 * The disposition itself: ONE class comment on the PR conversation
 * (`addComment`), then a `resolveReviewThread` for every member — one
 * request for the whole class. The two verbs in one mutation: a resolver
 * without the comment leaves the reply cost unchanged, and a comment
 * without the resolves is just a comment. The variables are declared by
 * the same count that `sweep` binds, so the query shape cannot drift from
 * what is sent.
 */
export function dispositionMutation(threadCount: number): string {
  const decl = Array.from(
    { length: threadCount },
    (_, i) => `$thread${i}: ID!`,
  ).join(", ");
  const resolves = Array.from(
    { length: threadCount },
    (
      _,
      i,
    ) => `  resolve${i}: resolveReviewThread(input: { threadId: $thread${i} }) {
    thread { id isResolved }
  }`,
  ).join("\n");
  return `mutation SweepDisposition($subject: ID!, $body: String!${decl ? `, ${decl}` : ""}) {
  addComment(input: { subjectId: $subject, body: $body }) {
    commentEdge { node { url } }
  }
${resolves}
}`;
}

/**
 * The class body: the disposition names the mechanism once, and every id
 * it applies to is listed verbatim — so a reader of any one thread can
 * see the class it was disposed with, and a reader of the comment can see
 * what was resolved.
 */
export function classBody(disposition: string, ids: readonly string[]): string {
  const listed = ids.map((id) => `  - \`${id}\``).join("\n");
  return `${disposition.trim()}\n\nThreads disposed by this one comment (${ids.length}):\n${listed}\n`;
}

/** What one sweep does: the PR, the class ids as typed, the disposition text. */
export interface SweepPlan {
  readonly pr: number;
  readonly requested: readonly string[];
  /** Written by the human, against the code. The tool never edits it. */
  readonly disposition: string;
}

export interface SweepDeps {
  readonly gh: (args: readonly string[]) => Promise<string>;
  /** Where the preview and the outcome go — stdout for the CLI. */
  readonly out: (line: string) => void;
  /** The one repository every call is pointed at. */
  readonly repo: RepoRef;
}

export interface SweepResult {
  readonly commentUrl: string | null;
  readonly resolvedThreadIds: readonly string[];
}

interface SweepReply extends PullRequestShape {
  readonly errors?: readonly { readonly message?: string }[];
}

/**
 * Fetch, verify, preview, then — with `post` — write.
 *
 * Two hazards, both from this week's hand sweeps, and both decided by the
 * platform's answer rather than by what the operator typed:
 *
 * 1. **Replying to the wrong thread is public and unrecoverable.** Every id
 *    is verified against the PR's real thread list before anything is
 *    written, and the exact comment plus the exact id list are printed as a
 *    preview. `post` is the sign-off on what was just shown; a preview run
 *    is the same call without the write.
 * 2. **A thread resolved without being addressed looks handled and is
 *    not.** An id that is already resolved, is a duplicate, or is not a
 *    review-thread node on this PR at all refuses the entire run, with
 *    every problem listed at once. A class that cannot be disposed as a
 *    class goes back to the operator, who re-reads the threads; the tool
 *    never guesses, and never writes half a class.
 *
 * The tool posts and resolves what it is told to. Whether the finding is
 * real is a judgement made against the code before the text is written —
 * the budget's own rules exist to keep that judgement out of the tool.
 */
export async function sweep(
  plan: SweepPlan,
  post: boolean,
  deps: SweepDeps,
): Promise<SweepResult> {
  const fetch = await fetchAllThreads(plan.pr, deps.gh, deps.repo);
  if (fetch.failures.length > 0) {
    throw new SweepRefusal(
      `the fetch of PR #${plan.pr} returned errors: ${fetch.failures.join("; ")}`,
      fetch.failures,
    );
  }
  const prId = fetch.prId;
  const fetched: readonly ThreadState[] = fetch.threads;

  const problems: string[] = [];
  const ids: string[] = [];
  for (const id of plan.requested) {
    if (ids.includes(id))
      problems.push(`${id}: duplicate — the class is ${ids.join(", ")}`);
    else ids.push(id);
  }
  if (prId === undefined) {
    problems.push(
      `PR #${plan.pr} does not exist or is not readable — there is nothing to post to`,
    );
  }
  for (const id of ids) {
    const found = fetched.find((t) => t.id === id);
    if (found === undefined)
      problems.push(`${id}: not a review-thread node on PR #${plan.pr}`);
    else if (found.isResolved)
      problems.push(`${id}: already resolved — a class member must be open`);
  }
  if (problems.length > 0) {
    throw new SweepRefusal(
      `refusing to sweep PR #${plan.pr} — class (${ids.join(", ")}): ${problems.join("; ")}. Nothing was posted.`,
      problems,
    );
  }

  const body = classBody(plan.disposition, ids);
  // Every id reaching the preview has just been verified open — the
  // guardrail above refuses the run if one is resolved or missing — so the
  // preview states that fact rather than re-checking it (which would be an
  // unreachable branch the moment the guardrail holds).
  [
    `PR #${plan.pr} — class disposition, ${ids.length} thread(s)`,
    ...ids.map((id) => `  ${id}  (open)`),
    "Comment that will be posted, verbatim:",
    "8<".padEnd(72, "-"),
    ...body.split("\n").map((line) => `| ${line}`),
    "8<".padEnd(72, "-"),
    post
      ? "--post given: writing now."
      : "preview only — re-run with --post when this is what you mean.",
  ].forEach((line) => deps.out(line));

  if (!post) return { commentUrl: null, resolvedThreadIds: [] };

  // No `--repo`: `gh api` does not take one. The repository is fixed by the
  // node ids, which were read from it a moment ago (`subject` is the PR's id,
  // each `thread` a thread of that PR), so a run cannot post its class comment
  // to a PR other than the one it verified.
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${dispositionMutation(ids.length)}`,
  ];
  ids.forEach((id, i) => args.push("-f", `thread${i}=${id}`));
  args.push("-f", `subject=${prId}`, "-f", `body=${body}`);
  // One mutation carries the comment and every resolve, and the platform can
  // apply the comment and then fail a resolve. So a failed write is never a
  // clean "nothing happened": the operator is told to look before retrying, or
  // a retry posts the same class comment twice.
  const mayHavePosted = (url: string | undefined): string =>
    `a comment may already have been posted on PR #${plan.pr} — check the PR conversation before retrying${url === undefined ? "" : ` (posted comment: ${url})`}`;
  let raw: string;
  try {
    raw = await deps.gh(args);
  } catch (error) {
    const reason = errorText(error);
    // `gh api graphql` exits non-zero when the response carries `errors` and
    // still prints the body, which the real `gh` dep attaches as `stdout`. A
    // comment the mutation did create is in it, so recover its url.
    const stdout = (error as { stdout?: unknown } | null)?.stdout;
    let recovered: string | undefined;
    if (typeof stdout === "string") {
      try {
        recovered = (
          (JSON.parse(stdout) as { data?: Record<string, unknown> }).data?.[
            "addComment"
          ] as { commentEdge?: { node?: { url?: string } } } | null | undefined
        )?.commentEdge?.node?.url;
      } catch {
        // Not JSON (a transport failure): there is nothing to recover.
      }
    }
    throw new SweepRefusal(
      `the mutation on PR #${plan.pr} failed: ${reason}; ${mayHavePosted(recovered)}`,
      [reason],
    );
  }
  const written = JSON.parse(raw) as {
    readonly data?: Record<string, unknown>;
    readonly errors?: readonly { readonly message?: string }[];
  };
  const writeErrors = written.errors?.map((e) =>
    String(e.message ?? "unknown GraphQL error"),
  );
  if (writeErrors !== undefined && writeErrors.length > 0) {
    const recovered = (
      written.data?.["addComment"] as
        | { commentEdge?: { node?: { url?: string } } }
        | null
        | undefined
    )?.commentEdge?.node?.url;
    throw new SweepRefusal(
      `the mutation on PR #${plan.pr} returned errors: ${writeErrors.join("; ")}; ${mayHavePosted(recovered)}`,
      writeErrors,
    );
  }
  const data = written.data ?? {};
  const comment = (
    data["addComment"] as
      | { commentEdge?: { node?: { url?: string } } }
      | undefined
  )?.commentEdge?.node;
  const resolvedIds = ids.filter((_, i) => {
    const r = data[`resolve${i}`] as
      | { thread?: { isResolved?: boolean } }
      | undefined;
    return r?.thread?.isResolved === true;
  });
  return { commentUrl: comment?.url ?? null, resolvedThreadIds: resolvedIds };
}
