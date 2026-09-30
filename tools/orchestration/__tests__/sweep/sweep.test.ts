import { describe, expect, test } from "vitest";
import {
  classBody,
  dispositionMutation,
  sweep,
  type SweepPlan,
} from "../../src/sweep/lib/sweep.js";
import { SweepRefusal } from "../../src/sweep/lib/types.js";
import { makeGh } from "../../src/sweep/cli.js";
import { REPO } from "./support.js";

/**
 * The class sweep: fetch, verify, preview, and — with `post` — write.
 *
 * Ported from the source suite. Every call now carries the repository it is
 * pointed at: the fetch passes it as the query's own `$owner`/`$name`
 * variables, the write passes `--repo`.
 */

/**
 * One complete page: `pageInfo` says there is no other one. A fixture that
 * omits it is a page the read cannot place — and a read that cannot place a
 * page is a failure now, not an empty answer.
 */
const threads = (...specs: readonly (readonly [string, boolean])[]): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: "PR_I_1",
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: specs.map(([id, isResolved]) => ({ id, isResolved })),
          },
        },
      },
    },
  });

const plan = (over: Partial<SweepPlan> = {}): SweepPlan => ({
  pr: 361,
  requested: ["PRRT_a", "PRRT_b"],
  disposition:
    'Refuted — `?? ["static"]` is the default family, not the support list.',
  ...over,
});

/** Records every gh call and answers the fetch (and the write) from fixtures. */
const recorder = (
  fetchResult: string,
  writeResult = JSON.stringify({ data: {} }),
) => {
  const calls: string[][] = [];
  return {
    calls,
    gh: async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      return args.some((a) => a.includes("mutation"))
        ? writeResult
        : fetchResult;
    },
    lines: [] as string[],
  };
};

describe("sweep — preview (hazard: the wrong thread is public and unrecoverable)", () => {
  test("prints every id, its state, and the exact comment, and writes nothing", async () => {
    const r = recorder(threads(["PRRT_a", false], ["PRRT_b", false]));
    const result = await sweep(plan(), false, {
      gh: r.gh,
      out: (l) => r.lines.push(l),
      repo: REPO,
    });
    expect(r.calls).toHaveLength(1);
    expect(result).toEqual({ commentUrl: null, resolvedThreadIds: [] });
    const shown = r.lines.join("\n");
    expect(shown).toContain("PR #361 — class disposition, 2 thread(s)");
    expect(shown).toContain("PRRT_a  (open)");
    expect(shown).toContain("PRRT_b  (open)");
    // The class body lands in the preview verbatim, so what is shown is
    // what would be posted — same string, not a summary of it.
    expect(shown).toContain('`?? ["static"]`');
    expect(shown).toContain("- `PRRT_a`");
    expect(shown).toContain("preview only");
  });

  test("--post sends the mutation; the same preview is printed first", async () => {
    const write = JSON.stringify({
      data: {
        addComment: {
          comment: { url: "https://github.com/o/r/pull/361#issuecomment-1" },
        },
        resolve0: { thread: { isResolved: true } },
        resolve1: { thread: { isResolved: true } },
      },
    });
    const events: string[] = [];
    const calls: string[][] = [];
    const lines: string[] = [];
    const gh = async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      if (args.some((a) => a.includes("mutation"))) {
        events.push("mutation");
        return write;
      }
      events.push("fetch");
      return threads(["PRRT_a", false], ["PRRT_b", false]);
    };
    const out = (l: string) => {
      lines.push(l);
      events.push(`out:${l}`);
    };

    const p = plan();
    const result = await sweep(p, true, { gh, out, repo: REPO });
    expect(calls).toHaveLength(2);
    expect(result.commentUrl).toContain("issuecomment-1");
    expect(result.resolvedThreadIds).toEqual(["PRRT_a", "PRRT_b"]);

    // Preview order: preview lines are printed first, strictly before mutation
    const mutationIdx = events.indexOf("mutation");
    expect(mutationIdx).toBeGreaterThan(0);
    const previewEvents = events.filter((e) => e.startsWith("out:"));
    expect(previewEvents.length).toBeGreaterThan(0);
    for (const pe of previewEvents) {
      expect(events.indexOf(pe)).toBeLessThan(mutationIdx);
    }
    // Preview order: header -> open threads -> comment preview -> sign-off
    const expectedBody = classBody(p.disposition, p.requested);
    expect(lines).toEqual([
      "PR #361 — class disposition, 2 thread(s)",
      "  PRRT_a  (open)",
      "  PRRT_b  (open)",
      "Comment that will be posted, verbatim:",
      "8<".padEnd(72, "-"),
      ...expectedBody.split("\n").map((line) => `| ${line}`),
      "8<".padEnd(72, "-"),
      "--post given: writing now.",
    ]);

    // The body posted in the mutation is the exact body given
    const mutationCall = calls[1];
    const bodyArg = mutationCall.find((a) => a.startsWith("body="));
    expect(bodyArg).toBe(`body=${expectedBody}`);
    expect(mutationCall[mutationCall.indexOf(`body=${expectedBody}`) - 1]).toBe(
      "-f",
    );
  });
});

describe("sweep — the class guardrail (hazard: resolved without being addressed)", () => {
  const fetchOnly =
    (result: string) =>
    async (args: readonly string[]): Promise<string> => {
      if (args.some((a) => a.includes("mutation")))
        throw new Error("a refused sweep must never write");
      return result;
    };

  const refusalOf = async (
    over: Partial<SweepPlan>,
    fetchResult: string,
  ): Promise<SweepRefusal> => {
    try {
      await sweep(plan(over), true, {
        gh: fetchOnly(fetchResult),
        out: () => undefined,
        repo: REPO,
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(SweepRefusal);
      return error as SweepRefusal;
    }
  };

  test("a resolved member refuses the whole class", async () => {
    const r = await refusalOf({}, threads(["PRRT_a", false], ["PRRT_b", true]));
    expect(r.reasons.join("\n")).toMatch(/PRRT_b: already resolved/);
  });

  test("an id that is not a thread on this PR refuses, naming it", async () => {
    const r = await refusalOf(
      { requested: ["PRRT_a", "PRVT_b"] },
      threads(["PRRT_a", false]),
    );
    expect(r.reasons.join("\n")).toMatch(/PRVT_b: not a review-thread node/);
  });

  test("duplicate ids are refused, not collapsed", async () => {
    const r = await refusalOf(
      { requested: ["PRRT_a", "PRRT_a"] },
      threads(["PRRT_a", false]),
    );
    expect(r.reasons.join("\n")).toMatch(/PRRT_a: duplicate/);
  });

  test("a GraphQL error on the fetch is a refusal carrying the message", async () => {
    const r = await refusalOf(
      {},
      JSON.stringify({
        errors: [{ message: "Could not resolve to a PullRequest" }],
      }),
    );
    expect(r.reasons.join("\n")).toContain(
      "Could not resolve to a PullRequest",
    );
  });

  test("a missing PR refuses — there is nothing to post to", async () => {
    const r = await refusalOf(
      {},
      JSON.stringify({ data: { repository: { pullRequest: null } } }),
    );
    expect(r.reasons.join("\n")).toMatch(/does not exist/);
  });
});

describe("sweep — the mutation carries the whole class", () => {
  test("one resolveReviewThread per member, addComment once", async () => {
    const r = recorder(threads(["PRRT_a", false], ["PRRT_b", false]));
    await sweep(plan(), true, { gh: r.gh, out: () => undefined, repo: REPO });
    const write = r.calls[1]?.join(" ") ?? "";
    expect((write.match(/resolveReviewThread/g) ?? []).length).toBe(2);
    expect((write.match(/addComment/g) ?? []).length).toBe(1);
    expect(write).toContain("PRRT_a");
    expect(write).toContain("PRRT_b");
    expect(write).toContain("PR_I_1"); // the PR node id — subject of the comment
  });

  test("a failed mutation says a comment may already have been posted, and prints the url it can recover", async () => {
    const gh = async (args: readonly string[]): Promise<string> =>
      args.some((a) => a.includes("mutation"))
        ? JSON.stringify({
            data: {
              addComment: { comment: { url: "https://gh/c#issuecomment-9" } },
            },
            errors: [{ message: "resolve failed" }],
          })
        : threads(["PRRT_a", false]);
    const error = await sweep(
      { pr: 361, requested: ["PRRT_a"], disposition: "x" },
      true,
      { gh, out: () => undefined, repo: { owner: "acme", name: "demo" } },
    ).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("resolve failed");
    expect(error?.message).toContain("may already have been posted");
    expect(error?.message).toContain("before retrying");
    expect(error?.message).toContain("https://gh/c#issuecomment-9");
  });

  test("through the bin's own gh wrapper: a rejection carrying stdout still yields the comment url", async () => {
    // The real dep REJECTS on a non-zero exit (`gh api graphql` exits 1 when the
    // response holds `errors`) and hands the body over on the rejection.
    const body = JSON.stringify({
      data: { addComment: { comment: { url: "https://x/c/1" } } },
      errors: [{ message: "resolve failed" }],
    });
    const gh = makeGh((_file, args, _options, callback) => {
      if (args.some((a) => a.includes("mutation")))
        callback(new Error("Command failed: gh"), body, "gh: exit 1");
      else callback(null, threads(["PRRT_a", false]), "");
    }, {});
    const error = await sweep(
      { pr: 361, requested: ["PRRT_a"], disposition: "x" },
      true,
      { gh, out: () => undefined, repo: { owner: "acme", name: "demo" } },
    ).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("may already have been posted");
    expect(error?.message).toContain("https://x/c/1");
  });

  test("a gh that exits non-zero on the write gets the same warning", async () => {
    const gh = async (args: readonly string[]): Promise<string> => {
      if (args.some((a) => a.includes("mutation")))
        throw new Error("gh: HTTP 502");
      return threads(["PRRT_a", false]);
    };
    const error = await sweep(
      { pr: 361, requested: ["PRRT_a"], disposition: "x" },
      true,
      { gh, out: () => undefined, repo: { owner: "acme", name: "demo" } },
    ).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("HTTP 502");
    expect(error?.message).toContain("may already have been posted");
  });

  test("a class of one posts one comment and one resolve", async () => {
    const r = recorder(threads(["PRRT_a", false]));
    await sweep(plan({ requested: ["PRRT_a"] }), true, {
      gh: r.gh,
      out: () => undefined,
      repo: REPO,
    });
    expect(
      (r.calls[1]?.join(" ").match(/resolveReviewThread/g) ?? []).length,
    ).toBe(1);
  });

  test("threads on subsequent pages are fetched and recognized", async () => {
    const calls: string[][] = [];
    const gh = async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      if (args.some((a) => a.includes("mutation"))) {
        return JSON.stringify({
          data: {
            addComment: { comment: { url: "https://gh/c" } },
            resolve0: { thread: { isResolved: true } },
            resolve1: { thread: { isResolved: true } },
          },
        });
      }
      if (args.includes("after=cursor_page1")) {
        return JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                id: "PR_I_1",
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ id: "PRRT_b", isResolved: false }],
                },
              },
            },
          },
        });
      }
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              id: "PR_I_1",
              reviewThreads: {
                pageInfo: { hasNextPage: true, endCursor: "cursor_page1" },
                nodes: [{ id: "PRRT_a", isResolved: false }],
              },
            },
          },
        },
      });
    };
    const result = await sweep(plan(), true, {
      gh,
      out: () => undefined,
      repo: REPO,
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("after=cursor_page1");
    expect(result.resolvedThreadIds).toEqual(["PRRT_a", "PRRT_b"]);
  });

  test("a GraphQL error on the mutation refuses rather than reporting success", async () => {
    const r = recorder(
      threads(["PRRT_a", false], ["PRRT_b", false]),
      JSON.stringify({ errors: [{ message: "Write permission denied" }] }),
    );
    await expect(
      sweep(plan(), true, { gh: r.gh, out: () => undefined, repo: REPO }),
    ).rejects.toThrow(
      /the mutation on PR #361 returned errors: Write permission denied/,
    );
  });

  test("an empty errors array on fetch and mutation is not an error", async () => {
    const gh = async (args: readonly string[]): Promise<string> => {
      if (args.some((a) => a.includes("mutation"))) {
        return JSON.stringify({
          data: {
            addComment: { comment: { url: "https://gh/c" } },
            resolve0: { thread: { isResolved: true } },
          },
          errors: [],
        });
      }
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              id: "PR_I_1",
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: "PRRT_a", isResolved: false }],
              },
            },
          },
        },
        errors: [],
      });
    };
    const result = await sweep(plan({ requested: ["PRRT_a"] }), true, {
      gh,
      out: () => undefined,
      repo: REPO,
    });
    expect(result.commentUrl).toBe("https://gh/c");
  });

  test("a mutation GraphQL error without a message refuses with unknown GraphQL error", async () => {
    const r = recorder(
      threads(["PRRT_a", false]),
      JSON.stringify({ errors: [{}] }),
    );
    await expect(
      sweep(plan({ requested: ["PRRT_a"] }), true, {
        gh: r.gh,
        out: () => undefined,
        repo: REPO,
      }),
    ).rejects.toThrow(/unknown GraphQL error/);
  });
});

describe("classBody and dispositionMutation", () => {
  test("the body names the mechanism once and lists the class verbatim", () => {
    const body = classBody("one sentence.", ["PRRT_a", "PRRT_b"]);
    expect(body).toContain("one sentence.");
    expect(body).toContain("Threads disposed by this one comment (2):");
    expect(body).toContain("- `PRRT_a`");
    expect(body.trim().split("one sentence.").length - 1).toBe(1);
  });

  test("the mutation declares each thread variable once", () => {
    const q = dispositionMutation(3);
    expect(q.match(/\$thread\d: ID!/g)).toEqual([
      "$thread0: ID!",
      "$thread1: ID!",
      "$thread2: ID!",
    ]);
    expect(q).toContain("resolve2: resolveReviewThread");
  });
});
