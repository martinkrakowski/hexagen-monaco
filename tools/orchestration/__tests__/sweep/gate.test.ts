import { describe, expect, test } from "vitest";
import {
  mergeGate,
  type MergeGateDecision,
  type MergeGatePlan,
} from "../../src/sweep/lib/gate.js";
import { REPO } from "./support.js";

/**
 * The merge condition: zero unresolved review threads on every page, and a head
 * that has not moved since its checks were read.
 *
 * Ported from the source suite. The one change is the repository: the gate is
 * pointed at one, and the head read names it.
 */

const HEAD = "abc1234";
const plan: MergeGatePlan = { pr: 361, head: HEAD };

const reasonsOf = (decision: MergeGateDecision): readonly string[] =>
  decision.kind === "refuse" ? decision.reasons : [];

/** A review-thread node as the API returns it, with the first comment the gate names it by. */
const node = (
  id: string,
  isResolved: boolean,
  over: { readonly author?: string; readonly body?: string } = {},
): Record<string, unknown> => ({
  id,
  isResolved,
  comments: {
    nodes: [
      {
        ...(over.author === undefined
          ? {}
          : { author: { login: over.author } }),
        body: over.body ?? "",
      },
    ],
  },
});

/**
 * A page whose `pageInfo` is written out by the caller, so a malformed one can
 * be sent: the well-formed `page` below is the only shape a healthy answer
 * takes, and the defects live in the answers that are not.
 */
const pageWith = (
  nodes: readonly Record<string, unknown>[],
  info?: Record<string, unknown>,
): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: "PR_I_1",
          reviewThreads: {
            ...(info === undefined ? {} : { pageInfo: info }),
            nodes,
          },
        },
      },
    },
  });

const page = (
  nodes: readonly Record<string, unknown>[],
  next?: string,
): string =>
  pageWith(nodes, { hasNextPage: next !== undefined, endCursor: next ?? null });

/**
 * Answers the threads query by cursor and `gh pr view` by `head`.
 *
 * `pages` is a function of the cursor rather than a list so that a test reading
 * a page it did not declare fails loudly instead of being answered "{}" — a
 * stub that invents pages is how a pagination bug survives its own test.
 */
const stub = (
  pages: (cursor: string) => string,
  head: string | Error = HEAD,
): { calls: string[][]; gh: (args: readonly string[]) => Promise<string> } => {
  const calls: string[][] = [];
  return {
    calls,
    gh: async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      if (args[0] === "pr") {
        if (head instanceof Error) throw head;
        return `${head}\n`;
      }
      const after = args.find((a) => a.startsWith("after="));
      return pages(after === undefined ? "" : after.slice("after=".length));
    },
  };
};

describe("mergeGate — unresolved threads", () => {
  test("zero unresolved across two pages allows the merge, and both pages are read", async () => {
    const s = stub((cursor) =>
      cursor === ""
        ? page([node("PRRT_a", true), node("PRRT_b", true)], "c1")
        : page([node("PRRT_c", true)]),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("merge");
    const reads = s.calls.filter((c) => c[0] === "api");
    expect(reads).toHaveLength(2);
    expect(reads[1]).toContain("after=c1");
    expect(s.calls.some((c) => c[0] === "pr")).toBe(true);
  });

  test("one unresolved thread on the second page is refused and named", async () => {
    const s = stub((cursor) =>
      cursor === ""
        ? page([node("PRRT_a", true)], "c1")
        : page([
            node("PRRT_b", false, {
              author: "qodo-merge",
              body: "this dereferences an undefined duration",
            }),
          ]),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("PRRT_b");
    expect(joined).toContain("qodo-merge");
    expect(joined).toContain("dereferences an undefined duration");
    // Threads are the cheaper answer: once one is open there is nothing a
    // head read could add, so the gate does not ask.
    expect(s.calls.some((c) => c[0] === "pr")).toBe(false);
  });

  test("a long first comment is excerpted, and a thread with no author still names the thread", async () => {
    const long = "x".repeat(200);
    const s = stub(() => page([node("PRRT_z", false, { body: long })]));
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("unknown");
    expect(joined).toContain(`"${"x".repeat(80)}…"`);
  });
});

describe("mergeGate — a page that cannot be read is undecidable, never empty", () => {
  test("a GraphQL error on the second page refuses as could-not-decide", async () => {
    const s = stub((cursor) =>
      cursor === ""
        ? page([node("PRRT_a", true)], "c1")
        : JSON.stringify({
            errors: [{ message: "Could not resolve to a PullRequest" }],
          }),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toContain("Could not resolve to a PullRequest");
  });

  test("a page whose gh call throws refuses as could-not-decide", async () => {
    const s = stub((cursor) => {
      if (cursor === "") return page([node("PRRT_a", true)], "c1");
      throw new Error("gh api graphql: HTTP 502");
    });
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toContain("HTTP 502");
  });

  test("a PR that is not readable refuses as could-not-decide", async () => {
    const s = stub(() =>
      JSON.stringify({ data: { repository: { pullRequest: null } } }),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    expect(reasonsOf(decision).join("\n")).toContain("could not decide");
  });
});

/**
 * A read that stopped before it had the whole PR is the same question as a page
 * that errored: the threads past the stop were never seen, and "none of the
 * threads I saw were open" is not "no thread is open". Every case below has a
 * PR whose *visible* threads are all resolved — the only thing standing between
 * it and a merge is whether the read was complete.
 */
describe("mergeGate — a read that stopped early is undecidable, never complete", () => {
  test("a page that reports another page but no endCursor refuses as could-not-decide", async () => {
    const s = stub(() =>
      pageWith([node("PRRT_a", true)], { hasNextPage: true, endCursor: null }),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/endCursor/);
    // The read never got as far as asking about the head: it does not know the
    // threads, and a head check on an incomplete read decides nothing.
    expect(s.calls.some((c) => c[0] === "pr")).toBe(false);
  });

  test("a page with no pageInfo refuses as could-not-decide", async () => {
    const s = stub(() => pageWith([node("PRRT_a", true)]));
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/pageInfo/);
  });

  test("a page whose hasNextPage is not a boolean refuses as could-not-decide", async () => {
    // `"yes"` is truthy, so a truthiness test would read it as "more pages" and
    // then act on an `endCursor` that came with a flag nobody understood. The
    // second page is well formed and clean, so the only finding is the flag.
    const s = stub((cursor) =>
      cursor === ""
        ? pageWith([node("PRRT_a", true)], {
            hasNextPage: "yes",
            endCursor: "c1",
          })
        : page([node("PRRT_b", true)]),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/pageInfo/);
  });

  test("a pull request whose reviewThreads is absent refuses as could-not-decide", async () => {
    // An absent connection is not an empty one: the query asks for it, so a
    // reply without it measured nothing.
    const s = stub(() =>
      JSON.stringify({
        data: { repository: { pullRequest: { id: "PR_I_1" } } },
      }),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/reviewThreads/);
  });

  test("a PR that loses its reviewThreads after a readable page refuses as could-not-decide", async () => {
    const s = stub((cursor) =>
      cursor === ""
        ? page([node("PRRT_a", true)], "c1")
        : JSON.stringify({
            data: { repository: { pullRequest: { id: "PR_I_1" } } },
          }),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/page 2/);
  });

  test("a cursor the read has already sent refuses as could-not-decide", async () => {
    let reads = 0;
    const decision = await mergeGate(plan, {
      repo: REPO,
      gh: async (args) => {
        if (args[0] === "pr") return `${HEAD}\n`;
        reads += 1;
        // Page two answers with page one's cursor, so an unbounded read asks
        // for page three, and four, forever. A stub that kept answering would
        // spin — before this guard exists the red state of this test IS an
        // endless read — so the third ask is refused loudly instead.
        if (reads > 2)
          throw new Error("the read asked for a page it had already read");
        const after = args.find((a) => a.startsWith("after="));
        return after === undefined
          ? page([node("PRRT_a", true)], "c1")
          : page([node("PRRT_b", true)], "c1");
      },
    });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/already sent/);
    expect(reads).toBe(2);
  });

  test("a read still paginating at the page bound refuses as could-not-decide", async () => {
    // The bound is 200 pages — 20,000 threads at 100 a page, two orders of
    // magnitude past any PR here — so reaching it is a cursor that never ends,
    // not a large PR. The stub stops answering past 400: with no bound at all
    // the read would never stop, and this test must fail rather than hang.
    const CAP = 400;
    let reads = 0;
    const decision = await mergeGate(plan, {
      repo: REPO,
      gh: async (args) => {
        if (args[0] === "pr") return `${HEAD}\n`;
        reads += 1;
        const after = args.find((a) => a.startsWith("after="));
        const n =
          after === undefined
            ? 1
            : Number(after.slice("after=".length).slice(1)) + 1;
        if (n > CAP)
          throw new Error(
            `the read asked for page ${n} and no bound stopped it`,
          );
        return page([node("PRRT_a", true)], `c${n}`);
      },
    });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toMatch(/still asking for page 201/);
    expect(reads).toBe(200);
  });

  test("a page that says there is no next page and carries no nodes is zero threads, not an unread page", async () => {
    // The counterweight to the case above it: what makes a read complete is
    // `pageInfo`, not `nodes`. A connection that reports no next page and no
    // nodes is a PR with no threads — calling it unread would refuse every
    // PR that has none.
    const s = stub(() =>
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              id: "PR_I_1",
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("merge");
    expect(decision.kind === "merge" ? decision.summary : "").toContain(
      "0 review thread(s)",
    );
  });
});

describe("mergeGate — the head the checks were verified on", () => {
  test("a head that moved is refused, naming both SHAs", async () => {
    const s = stub(() => page([node("PRRT_a", true)]), "deadbeef");
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain(HEAD);
    expect(joined).toContain("deadbeef");
    expect(joined).toMatch(/head moved/);
  });

  test("a head that could not be read refuses as could-not-decide", async () => {
    const s = stub(
      () => page([node("PRRT_a", true)]),
      new Error("gh pr view: HTTP 502"),
    );
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    const joined = reasonsOf(decision).join("\n");
    expect(joined).toContain("could not decide");
    expect(joined).toContain("HTTP 502");
  });

  test("a head read that throws something other than an Error is still reported", async () => {
    const decision = await mergeGate(plan, {
      repo: REPO,
      gh: async (args) => {
        if (args[0] === "pr") throw "gh: not logged in";
        return page([node("PRRT_a", true)]);
      },
    });
    expect(decision.kind).toBe("refuse");
    expect(reasonsOf(decision).join("\n")).toContain("gh: not logged in");
  });

  test("a head answer that is empty refuses rather than matching", async () => {
    const s = stub(() => page([node("PRRT_a", true)]), "");
    const decision = await mergeGate(plan, { gh: s.gh, repo: REPO });
    expect(decision.kind).toBe("refuse");
    expect(reasonsOf(decision).join("\n")).toMatch(/no head/);
  });
});
