import { describe, expect, test, vi } from "vitest";
import {
  PLAN_DIR,
  runCli,
  type PlanVerifyIo,
} from "../../src/plan-verify/cli.js";
import {
  ARTIFACT_VERSION,
  parseArtifact,
} from "../../src/internal/artifact.js";

interface Written {
  readonly path: string;
  readonly contents: string;
}

interface Harness {
  readonly io: PlanVerifyIo;
  readonly log: ReturnType<typeof vi.fn>;
  readonly gitCalls: () => readonly (readonly string[])[];
  readonly artifact: () => Written | undefined;
}

const io = (over: Partial<PlanVerifyIo> = {}): Harness => {
  const log = vi.fn((): void => undefined);
  const gitArgs: (readonly string[])[] = [];
  let written: Written | undefined;
  return {
    log,
    gitCalls: () => gitArgs,
    artifact: () => written,
    io: {
      argv: [],
      log,
      readFile: async () => "```premise W1\ntrue\n```",
      listPlanDir: async (): Promise<readonly string[]> => ["a.md"],
      deps: { execute: async () => ({ exitCode: 0, output: "" }) },
      now: () => "2026-09-13T12:00:00.000Z",
      git: async (args) => {
        gitArgs.push(args);
        return args[1] === "--abbrev-ref" ? "feat/test-branch\n" : "deadbeef\n";
      },
      artifactPath: () => "/tmp/plan-verify.json",
      writeArtifact: async (path, contents) => {
        written = { path, contents };
      },
      ...over,
    },
  };
};

describe("the artifact carries the repository it was written for", () => {
  test("repo is stamped when the bin knows it, and absent when it does not", async () => {
    const stamped = io({ repo: "acme/demo" });
    await runCli(stamped.io);
    expect(parseArtifact(stamped.artifact()!.contents).repo).toBe("acme/demo");

    const bare = io();
    await runCli(bare.io);
    expect(parseArtifact(bare.artifact()!.contents).repo).toBeUndefined();
  });
});

describe("runCli", () => {
  test("exits 0 and says so when every premise holds", async () => {
    const { io: i, log } = io();
    expect(await runCli(i)).toBe(0);
    expect(log).toHaveBeenCalledWith("1 premise(s) hold; no lane is stale.");
  });

  test("exits 1 and names the lane when a premise is stale", async () => {
    const { io: i, log } = io({
      deps: { execute: async () => ({ exitCode: 1, output: "" }) },
    });
    expect(await runCli(i)).toBe(1);
    expect(log.mock.calls[0]?.[0]).toContain("STALE  W1");
  });

  test("with no arguments it reads the planning directory, ignoring non-markdown", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>(
      async () => "```premise X\ntrue\n```",
    );
    const listPlanDir = async (): Promise<readonly string[]> => [
      "b.md",
      "notes.txt",
      "a.md",
    ];
    await runCli(io({ listPlanDir, readFile }).io);
    expect(readFile.mock.calls.map((c) => c[0])).toEqual([
      `${PLAN_DIR}/a.md`,
      `${PLAN_DIR}/b.md`,
    ]);
  });

  test("given paths, it checks exactly those and never lists the directory", async () => {
    const listPlanDir = vi.fn(async (): Promise<readonly string[]> => []);
    const readFile = vi.fn<(p: string) => Promise<string>>(
      async () => "```premise X\ntrue\n```",
    );
    await runCli(io({ argv: ["one.md", "two.md"], listPlanDir, readFile }).io);
    expect(listPlanDir).not.toHaveBeenCalled();
    expect(readFile.mock.calls.map((c) => c[0])).toEqual(["one.md", "two.md"]);
  });

  test("a plan with no premises is not an error", async () => {
    const { io: i, log } = io({ readFile: async () => "# just prose" });
    expect(await runCli(i)).toBe(0);
    expect(log).toHaveBeenCalledWith("0 premise(s) hold; no lane is stale.");
  });

  test("an emptied premise fails the run, naming the plan and the lane", async () => {
    const { io: i } = io({ readFile: async () => "```premise W9\n   \n```" });
    await expect(runCli(i)).rejects.toThrow(
      /EMPTY\s+W9\s+\(docs\/planning\/a\.md\)/,
    );
  });
});

describe("the result artifact (S5)", () => {
  test("a holding run records provenance and verdicts the page can render", async () => {
    const h = io();
    expect(await runCli(h.io)).toBe(0);
    expect(h.artifact()?.path).toBe("/tmp/plan-verify.json");
    expect(parseArtifact(h.artifact()!.contents)).toEqual({
      version: ARTIFACT_VERSION,
      at: "2026-09-13T12:00:00.000Z",
      git: { branch: "feat/test-branch", head: "deadbeef" },
      scope: { kind: "full" },
      plans: [`${PLAN_DIR}/a.md`],
      premises: [{ lane: "W1", plan: `${PLAN_DIR}/a.md`, status: "holds" }],
    });
  });

  test("a stale run records it too — the verdict the gate failed on is the backlog's news", async () => {
    const h = io({
      deps: {
        execute: async () => ({ exitCode: 1, output: "merged already" }),
      },
    });
    expect(await runCli(h.io)).toBe(1);
    expect(parseArtifact(h.artifact()!.contents).premises[0]).toEqual({
      lane: "W1",
      plan: `${PLAN_DIR}/a.md`,
      status: "stale",
      reason: "merged already",
    });
  });

  test("a timed-out run records it too", async () => {
    const h = io({
      deps: {
        execute: async () => ({ exitCode: 1, output: "", timedOut: true }),
      },
    });
    expect(await runCli(h.io)).toBe(2);
    expect(parseArtifact(h.artifact()!.contents).premises[0]?.status).toBe(
      "timed-out",
    );
  });

  test("a subset run records itself as partial — never the whole backlog", async () => {
    const h = io({ argv: ["docs/planning/one.md"] });
    expect(await runCli(h.io)).toBe(0);
    const artifact = parseArtifact(h.artifact()!.contents);
    expect(artifact.scope).toEqual({
      kind: "partial",
      plans: ["docs/planning/one.md"],
    });
    expect(artifact.plans).toEqual(["docs/planning/one.md"]);
  });

  test("provenance comes from fixed git commands, and nothing else", async () => {
    const h = io();
    await runCli(h.io);
    expect(h.gitCalls()).toEqual([
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["rev-parse", "HEAD"],
    ]);
  });

  test("a git that cannot answer records unknown provenance, and still writes", async () => {
    const h = io({
      git: async () => {
        throw new Error("not a git repository");
      },
    });
    expect(await runCli(h.io)).toBe(0);
    expect(parseArtifact(h.artifact()!.contents).git).toEqual({
      branch: "unknown",
      head: "unknown",
    });
  });

  test("an empty git answer is unknown provenance, not an empty string", async () => {
    const h = io({ git: async () => "  \n" });
    await runCli(h.io);
    expect(parseArtifact(h.artifact()!.contents).git.branch).toBe("unknown");
  });

  test("a failed artifact write warns and leaves a holding exit code unchanged", async () => {
    const h = io({
      writeArtifact: async () => {
        throw new Error("read-only filesystem");
      },
    });
    expect(await runCli(h.io)).toBe(0);
    const warn = h.log.mock.calls
      .map((c) => String(c[0]))
      .find((t) => t.includes("WARN"));
    expect(warn).toContain("read-only filesystem");
    expect(warn).toContain("/tmp/plan-verify.json");
  });

  test("a failed artifact write leaves a stale run exiting stale — the gate is first", async () => {
    const h = io({
      deps: { execute: async () => ({ exitCode: 1, output: "" }) },
      writeArtifact: async () => {
        throw new Error("disk full");
      },
    });
    expect(await runCli(h.io)).toBe(1);
  });

  test("a run that found no premises still records — a full run with an empty backlog", async () => {
    const h = io({ readFile: async () => "# prose only" });
    expect(await runCli(h.io)).toBe(0);
    const artifact = parseArtifact(h.artifact()!.contents);
    expect(artifact.premises).toEqual([]);
    expect(artifact.scope.kind).toBe("full");
  });

  test("reads git branch and head before running the first premise", async () => {
    const callOrder: string[] = [];
    const git = vi.fn(async () => {
      callOrder.push("git");
      return "feat/branch\n";
    });
    const execute = vi.fn(async () => {
      callOrder.push("execute");
      return { exitCode: 0, output: "" };
    });
    const h = io({ git, deps: { execute } });
    await runCli(h.io);
    expect(callOrder.length).toBeGreaterThanOrEqual(2);
    expect(callOrder.indexOf("git")).toBeLessThan(callOrder.indexOf("execute"));
  });
});
