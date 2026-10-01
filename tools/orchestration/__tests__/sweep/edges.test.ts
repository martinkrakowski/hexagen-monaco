import { describe, expect, test } from "vitest";
import { dispositionMutation, sweep } from "../../src/sweep/lib/sweep.js";
import { runCli } from "../../src/sweep/cli.js";
import { harness, REPO } from "./support.js";

/**
 * The edges: the refusals that keep half a class from landing, the mutation's
 * shape, and the three ways a non-`Error` throw has to be reported.
 *
 * Ported from the source suite.
 */

const ghFetch =
  (
    nodes: readonly { id: string; isResolved: boolean }[],
    writeResult?: string,
  ) =>
  async (args: readonly string[]): Promise<string> => {
    if (args.some((a) => a.includes("mutation"))) {
      return (
        writeResult ??
        JSON.stringify({
          data: {
            addComment: { commentEdge: { node: { url: "https://gh/c1" } } },
            resolve0: { thread: { isResolved: true } },
          },
        })
      );
    }
    return JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            id: "PR_I_1",
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes,
            },
          },
        },
      },
    });
  };

describe("sweep — refusals that keep half a class from landing", () => {
  test("a single wrong id refuses too — the check is not batch-only", async () => {
    await expect(
      sweep({ pr: 361, requested: ["PRVT_x"], disposition: "x" }, true, {
        gh: ghFetch([]),
        out: () => undefined,
        repo: REPO,
      }),
    ).rejects.toThrow(/not a review-thread node/);
  });

  test("a pull request whose reviewThreads field is absent is a failed read, not an empty one", async () => {
    // Changed 2026-09-14, and the change is the point: this used to assert that
    // an absent connection reads as "no threads", which is how a PR with an open
    // thread was reported as having none. `fetchAllThreads` now decides whether
    // a merge happens, so a read that measured nothing must be recorded, not
    // reported as an empty answer — and the sweep refuses the whole run on it
    // rather than reporting one id as wrong. A refused read posts nothing,
    // which is what the `--post` below is here to prove.
    const calls: string[][] = [];
    await expect(
      sweep({ pr: 361, requested: ["PRRT_a"], disposition: "x" }, true, {
        repo: REPO,
        gh: async (args) => {
          calls.push([...args]);
          return JSON.stringify({
            data: { repository: { pullRequest: { id: "PR_I_1" } } },
          });
        },
        out: () => undefined,
      }),
    ).rejects.toThrow(/returned errors: .*reviewThreads/);
    expect(calls.filter((c) => c.some((a) => a.includes("mutation")))).toEqual(
      [],
    );
  });

  test("a GraphQL error without a message is refused, not swallowed", async () => {
    await expect(
      sweep({ pr: 361, requested: ["PRRT_a"], disposition: "x" }, false, {
        gh: async () => JSON.stringify({ errors: [{}] }),
        out: () => undefined,
        repo: REPO,
      }),
    ).rejects.toThrow(/unknown GraphQL error/);
  });
});

describe("sweep — the post write", () => {
  test("a write that reports no data resolves nothing, and says so", async () => {
    const r = await sweep(
      { pr: 361, requested: ["PRRT_a"], disposition: "x" },
      true,
      {
        gh: ghFetch([{ id: "PRRT_a", isResolved: false }], "{}"),
        out: () => undefined,
        repo: REPO,
      },
    );
    expect(r.commentUrl).toBeNull();
    expect(r.resolvedThreadIds).toEqual([]);
  });
});

describe("mutation shape", () => {
  test("the head has no thread variables when there are none", () => {
    expect(dispositionMutation(0)).not.toMatch(/\$thread\d: ID!/);
  });

  test("the fetch sends the number with `-F`: `-f` makes it a string and GraphQL refuses Int!", async () => {
    const calls: string[][] = [];
    await sweep({ pr: 361, requested: ["PRRT_a"], disposition: "x" }, false, {
      repo: REPO,
      gh: async (args) => {
        calls.push([...args]);
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
        });
      },
      out: () => undefined,
    });
    const fetchArgs = calls[0] ?? [];
    const numberFlag = fetchArgs[fetchArgs.indexOf("number=361") - 1];
    expect(numberFlag).toBe("-F");
    expect(fetchArgs).toContain("-f"); // the query itself stays -f: it is a String
  });
});

describe("runCli — edges", () => {
  /** The stubbed io, with only `argv`, `logError` and `gh` replaced per test. */
  const world = () => {
    const h = harness({ readFile: async () => "" });
    return { ...h.io, log: () => undefined };
  };

  test("an empty argv names the missing command and exits 2", async () => {
    const err: string[] = [];
    const code = await runCli({
      ...world(),
      argv: [],
      logError: (t) => err.push(t),
      gh: async () => "{}",
    });
    expect(code).toBe(2);
    expect(err.join(" ")).toContain("'undefined' is not a command");
  });

  test("a non-Error throw from the WRITE is reported and exits 1", async () => {
    // The fetch is wrapped — an unreadable page is a refusal now — so the
    // catch-all in runCli is reached through the mutation, which is not: a
    // string thrown there must still be named, not swallowed by the exit code.
    const err: string[] = [];
    const code = await runCli({
      ...world(),
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--body",
        "x",
        "--post",
      ],
      logError: (t) => err.push(t),
      gh: async (args) => {
        // Both calls carry `query=` — the fetch's value is the query, the
        // write's is the mutation — so the write is the one named "mutation".
        if (args.some((a) => a.includes("mutation")))
          throw "write-failed-as-a-string";
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
        });
      },
    });
    expect(code).toBe(1);
    expect(err.join(" ")).toContain("write-failed-as-a-string");
  });

  test("a non-Error throw from gh is reported and exits 1", async () => {
    const err: string[] = [];
    const code = await runCli({
      ...world(),
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--body",
        "x",
        "--post",
      ],
      logError: (t) => err.push(t),
      gh: async (args) => {
        if (args.some((a) => a.includes("query="))) throw "not-an-error";
        return "{}";
      },
    });
    expect(code).toBe(1);
    expect(err.join(" ")).toContain("not-an-error");
  });
});
