import { describe, expect, test } from "vitest";
import {
  SWEEP_COMMAND,
  ghChildEnv,
  runCli,
  type SweepCliIo,
} from "../../src/sweep/cli.js";
import { harness } from "./support.js";

/**
 * The command face: the three verbs, their exit codes, and the `gh` child
 * environment.
 *
 * Ported from the source suite. The io carries the project's overlay, the
 * repository root and the one repository every call is pointed at.
 */

const ok = (
  over: Partial<SweepCliIo> = {},
): { io: SweepCliIo; log: string[]; err: string[] } => {
  const h = harness({
    argv: [
      "threads",
      "--pr",
      "361",
      "--thread",
      "PRRT_a",
      "--thread",
      "PRRT_b",
      "--body",
      "one class",
    ],
    readFile: async () => "body from file",
    gh: async (args) =>
      args.some((a) => a.includes("mutation"))
        ? JSON.stringify({
            data: {
              addComment: { comment: { url: "https://gh/issuecomment-1" } },
              resolve0: { thread: { isResolved: true } },
              resolve1: { thread: { isResolved: true } },
            },
          })
        : JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  id: "PR_I_1",
                  reviewThreads: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      { id: "PRRT_a", isResolved: false },
                      { id: "PRRT_b", isResolved: false },
                    ],
                  },
                },
              },
            },
          }),
    ...over,
  });
  return { io: h.io, log: h.log, err: h.err };
};

/** `sweep gate`: the PR with no unresolved threads, on the head it was verified on. */
const okGate = (
  over: Partial<SweepCliIo> = {},
): { io: SweepCliIo; log: string[]; err: string[] } => {
  const h = harness({
    argv: ["gate", "--pr", "361", "--sha", "abc1234"],
    readFile: async () => "",
    gh: async (args) =>
      args[0] === "pr"
        ? "abc1234\n"
        : JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  id: "PR_I_1",
                  reviewThreads: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [{ id: "PRRT_a", isResolved: true }],
                  },
                },
              },
            },
          }),
    ...over,
  });
  return { io: h.io, log: h.log, err: h.err };
};

describe("runCli", () => {
  test("only the `threads` verb exists among the three reviewed ones", async () => {
    const { io, err } = ok({ argv: ["resolve", "--pr", "1"] });
    expect(await runCli(io)).toBe(2);
    expect(err.join(" ")).toContain(SWEEP_COMMAND);
  });

  test("an unknown command lists every command's usage, each naming the bin", async () => {
    const { io, err } = ok({ argv: ["yolo"] });
    expect(await runCli(io)).toBe(2);
    const out = err.join("\n");
    for (const line of [
      "threads",
      "gate",
      "attribute",
      "keep-both",
      "append-only",
      "checks",
      "config",
    ]) {
      expect(out, line).toContain(line);
    }
    expect(out.match(/hexagen-orchestration-sweep/g)?.length).toBe(7);
  });

  test("a bad flag exits 2 with the usage, before any gh call", async () => {
    let ghCalls = 0;
    const base = ok();
    const { io, err } = ok({
      argv: ["threads", "--pr", "not-a-number", "--thread", "a", "--body", "x"],
      gh: async (args) => {
        ghCalls += 1;
        return base.io.gh(args);
      },
    });
    expect(await runCli(io)).toBe(2);
    expect(ghCalls).toBe(0);
    expect(err.join(" ")).toContain("wants a number");
  });

  test("--body-file is read and lands verbatim in the posted mutation", async () => {
    const calls: string[][] = [];
    const { io, log } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--thread",
        "PRRT_b",
        "--body-file",
        "d.md",
        "--post",
      ],
      readFile: async (p) => {
        expect(p).toBe("d.md");
        return "body from file on disk";
      },
      gh: async (args) => {
        calls.push([...args]);
        return args.some((a) => a.includes("mutation"))
          ? JSON.stringify({
              data: {
                addComment: {
                  comment: { url: "https://gh/issuecomment-bodyfile" },
                },
                resolve0: { thread: { isResolved: true } },
                resolve1: { thread: { isResolved: true } },
              },
            })
          : JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    id: "PR_I_1",
                    reviewThreads: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        { id: "PRRT_a", isResolved: false },
                        { id: "PRRT_b", isResolved: false },
                      ],
                    },
                  },
                },
              },
            });
      },
    });
    expect(await runCli(io)).toBe(0);
    expect(calls).toHaveLength(2);
    const mutationCall = calls[1]!;
    expect(mutationCall.some((a) => a.includes("mutation"))).toBe(true);
    expect(mutationCall).toContain("thread0=PRRT_a");
    expect(mutationCall).toContain("thread1=PRRT_b");
    expect(mutationCall).toContain("subject=PR_I_1");
    expect(mutationCall).toContain(
      "body=body from file on disk\n\nThreads disposed by this one comment (2):\n  - `PRRT_a`\n  - `PRRT_b`\n",
    );
    expect(log.join("\n")).toContain(
      "class disposed: https://gh/issuecomment-bodyfile",
    );
  });

  test("preview-only exits 0 and resolves nothing", async () => {
    const { io, log } = ok();
    expect(await runCli(io)).toBe(0);
    expect(log.join("\n")).toContain("preview only");
  });

  test("--post disposes the class and reports the comment url", async () => {
    const { io, log } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--thread",
        "PRRT_b",
        "--body",
        "x",
        "--post",
      ],
    });
    expect(await runCli(io)).toBe(0);
    expect(log.join("\n")).toContain(
      "class disposed: https://gh/issuecomment-1",
    );
  });

  test("a comment posted without a url is called out, not trusted", async () => {
    const { io, err } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--thread",
        "PRRT_b",
        "--body",
        "x",
        "--post",
      ],
      gh: async (args) =>
        args.some((a) => a.includes("mutation"))
          ? JSON.stringify({
              data: {
                resolve0: { thread: { isResolved: true } },
                resolve1: { thread: { isResolved: true } },
              },
            })
          : JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    id: "PR_I_1",
                    reviewThreads: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        { id: "PRRT_a", isResolved: false },
                        { id: "PRRT_b", isResolved: false },
                      ],
                    },
                  },
                },
              },
            }),
    });
    expect(await runCli(io)).toBe(1);
    expect(err.join("\n")).toContain("did not report a url");
  });

  test("a blank body-file is refused with exit 2", async () => {
    const { io, err } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--body-file",
        "empty.md",
      ],
      readFile: async () => "   \n\t  ",
    });
    expect(await runCli(io)).toBe(2);
    expect(err.join("\n")).toContain("a disposition body must not be blank");
  });

  test("a thread that did not come back resolved is a failed sweep", async () => {
    const { io, err, log } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--thread",
        "PRRT_b",
        "--body",
        "x",
        "--post",
      ],
      gh: async (args) =>
        args.some((a) => a.includes("mutation"))
          ? JSON.stringify({
              data: {
                addComment: { comment: { url: "u" } },
                resolve0: { thread: { isResolved: true } },
                resolve1: { thread: { isResolved: false } },
              },
            })
          : JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    id: "PR_I_1",
                    reviewThreads: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        { id: "PRRT_a", isResolved: false },
                        { id: "PRRT_b", isResolved: false },
                      ],
                    },
                  },
                },
              },
            }),
    });
    expect(await runCli(io)).toBe(1);
    expect(err.join(" ")).toContain("PRRT_b");
    expect(log.join("\n")).not.toContain("class disposed");
  });

  test("a refusal exits 1 and lists every offending id", async () => {
    const { io, err } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--thread",
        "PRVT_x",
        "--body",
        "x",
        "--post",
      ],
    });
    expect(await runCli(io)).toBe(1);
    expect(err.join("\n")).toContain("PRVT_x: not a review-thread node");
    expect(err.join("\n")).toContain("PRRT_a"); // the header names the class too
  });

  test("a gh failure exits 1 with its message", async () => {
    const { io, err } = ok({
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
      gh: async () => {
        throw new Error("gh api graphql: HTTP 401");
      },
    });
    expect(await runCli(io)).toBe(1);
    expect(err.join(" ")).toContain("HTTP 401");
  });

  test("`gate` exits 0 and says the merge condition is met", async () => {
    const { io, log } = okGate();
    expect(await runCli(io)).toBe(0);
    expect(log.join("\n")).toContain("merge condition met");
    expect(log.join("\n")).toContain("PR #361");
  });

  test("`gate` exits 1 and lists every reason when the condition is unmet", async () => {
    // The one unresolved thread is resolved here so the gate reaches the head
    // read: a refusal is reported the same way whichever condition failed, and
    // this one is the head the operator cannot see without being told.
    const { io, err, log } = okGate({
      gh: async (args) =>
        args[0] === "pr"
          ? "deadbeef\n"
          : JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    id: "PR_I_1",
                    reviewThreads: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [{ id: "PRRT_a", isResolved: true }],
                    },
                  },
                },
              },
            }),
    });
    expect(await runCli(io)).toBe(1);
    expect(err.join("\n")).toContain("refusing to merge PR #361");
    expect(err.join("\n")).toContain("head moved");
    expect(err.join("\n")).toContain("deadbeef");
    expect(log.join("\n")).not.toContain("merge condition met");
  });

  test("`gate` with a bad command line exits 2 before any gh call", async () => {
    let ghCalls = 0;
    const { io, err } = okGate({
      argv: ["gate", "--pr", "361"],
      gh: async (args) => {
        ghCalls += 1;
        return args[0] === "pr" ? "abc1234\n" : "{}";
      },
    });
    expect(await runCli(io)).toBe(2);
    expect(ghCalls).toBe(0);
    expect(err.join("\n")).toContain("--sha is required");
  });

  test("a non-Error throw while the body is read exits 2 with its message", async () => {
    // A starved readFile throws from the plan-building block, which runCli
    // guards with 2 — the same exit the argument parser uses, since both
    // mean "the run never reached the PR". A non-Error thrown *by the
    // sweep* (exit 1) is pinned in edges.test.ts.
    const { io, err } = ok({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--body-file",
        "d.md",
      ],
      readFile: async () => {
        throw "string failure";
      },
    });
    expect(await runCli(io)).toBe(2);
    expect(err.join(" ")).toContain("string failure");
  });
});

describe("ghChildEnv", () => {
  test("drops FORCE_COLOR so gh writes JSON that JSON.parse can read", () => {
    const env = ghChildEnv({
      FORCE_COLOR: "1",
      CLICOLOR_FORCE: "1",
      PATH: "/bin",
    });
    expect(env.FORCE_COLOR).toBeUndefined();
    expect(env.CLICOLOR_FORCE).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });
});
