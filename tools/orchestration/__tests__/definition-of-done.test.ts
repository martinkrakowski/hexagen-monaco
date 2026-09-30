import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { parseArtifact } from "../src/internal/artifact.js";
import { runCli as planVerify, PLAN_DIR } from "../src/plan-verify/cli.js";
import { EXIT_TIMED_OUT } from "../src/plan-verify/lib/verify.js";
import {
  checkHandoff,
  exitCodeFor,
  formatReport,
  EXIT_NOT_READY,
} from "../src/handoff-check/lib/check.js";
import { parseHandoff } from "../src/handoff-check/lib/handoff.js";
import { runCli as controlBytes } from "../src/control-bytes/cli.js";
import {
  exitCodeFor as controlBytesExit,
  scanBytes,
} from "../src/control-bytes/lib/scan.js";
import { runWaveEvent } from "../src/internal/wave-event-cli.js";

/**
 * The plan's Definition of Done for the three bins OW3a owns, plus wave-event,
 * each as ONE NAMED case run through the tool's own entry point rather than
 * through one of its units.
 *
 * "A gate that has not been shown to fail has not been shown to exist" — so
 * each of these is a case where the tool could plausibly have passed, and the
 * test says it must not.
 */

const plan = (...premises: ReadonlyArray<readonly [string, string]>): string =>
  [
    "## 1. Premises",
    "",
    ...premises.flatMap(([lane, script]) => [
      `\`\`\`premise ${lane}`,
      script,
      "```",
      "",
    ]),
  ].join("\n");

/** Holds and one that outlives the ceiling — nothing stale, so the code is 2. */
const HOLDS_AND_HANGS = plan(
  ["OW1-holds", "echo holds"],
  ["OW2-timed-out", "echo hangs"],
);
/** The same, plus a stale premise, which is the more actionable verdict. */
const HOLDS_HANGS_AND_STALE = plan(
  ["OW1-holds", "echo holds"],
  ["OW2-timed-out", "echo hangs"],
  ["OW3-stale", "echo stale"],
);

/** Plan-verify, with the executor answering per lane. */
function planVerifyIo(
  execute: (script: string) => Promise<{
    exitCode: number;
    output: string;
    timedOut?: boolean;
  }>,
  planText: string,
) {
  const logged: string[] = [];
  let artifact = "";
  return {
    logged,
    io: {
      argv: [`${PLAN_DIR}/p.md`],
      log: (text: string) => void logged.push(text),
      readFile: async () => planText,
      listPlanDir: async () => [],
      deps: { execute },
      now: () => "2026-09-29T00:00:00.000Z",
      git: async () => "ref\n",
      artifactPath: () => "/tmp/plan-verify.json",
      writeArtifact: async (_p: string, contents: string) =>
        void (artifact = contents),
    },
    get artifact() {
      return artifact;
    },
  };
}

describe("§7 plan-verify", () => {
  test("a premise whose command outlives PREMISE_TIMEOUT_MS is EXIT_TIMED_OUT, never passed", async () => {
    // A premise killed at the ceiling has NO verdict. Reporting it as `holds`
    // would read as "the gap is still open, dispatch the lane" on the strength
    // of a check that never finished.
    const run = planVerifyIo(async (script) => {
      if (script === "echo hangs")
        return { exitCode: 0, output: "", timedOut: true };
      if (script === "echo stale")
        return { exitCode: 1, output: "already closed", timedOut: false };
      return { exitCode: 0, output: "", timedOut: false };
    }, HOLDS_AND_HANGS);
    const code = await planVerify(run.io);

    expect(code).toBe(EXIT_TIMED_OUT);
    expect(code).toBe(2);
    expect(run.logged.join("\n")).toContain("TIMED-OUT  OW2-timed-out");
    expect(run.logged.join("\n")).not.toContain(
      "OW2-timed-out  the premise exited",
    );

    // And it is recorded as such, so the status page cannot read it as a pass.
    const artifact = parseArtifact(run.artifact);
    const timedOut = artifact.premises.filter((p) => p.status === "timed-out");
    expect(timedOut.map((p) => p.lane)).toEqual(["OW2-timed-out"]);
    expect(
      artifact.premises.some(
        (p) => p.lane === "OW2-timed-out" && p.status === "holds",
      ),
    ).toBe(false);
  });

  test("a stale premise still wins the exit code over a timed-out one", async () => {
    const run = planVerifyIo(
      async (script) =>
        script === "echo hangs"
          ? { exitCode: 0, output: "", timedOut: true }
          : { exitCode: 1, output: "", timedOut: false },
      HOLDS_HANGS_AND_STALE,
    );
    expect(await planVerify(run.io)).toBe(1);
  });
});

describe("§7 handoff-check", () => {
  const handoff = {
    version: 1 as const,
    lane: "OW1",
    files: ["__tests__/x.test.ts"],
    rules: [
      {
        id: "R1",
        statement: "The scan refuses a bare NUL.",
        test: "refuses a raw NUL",
      },
      {
        id: "R2",
        statement: "The scan names the line.",
        test: "names the line",
      },
    ],
  };

  const report = (failing: readonly string[]) =>
    checkHandoff(handoff, {
      readFile: async () =>
        `test("refuses a raw NUL", () => {});\ntest("names the line", () => {});\n`,
      failingTests: async () => [...failing],
    });

  test("a handoff whose named test is currently PASSING is reported not ready", async () => {
    // A test that already passes pins nothing: stage 2 would satisfy it by
    // changing nothing at all. That is the rule's whole content.
    const result = await report(["names the line"]);
    expect(result.bindings[0]?.status).toBe("passing");
    expect(exitCodeFor(result)).toBe(EXIT_NOT_READY);
    expect(exitCodeFor(result)).not.toBe(0);
    expect(formatReport(result)).toContain("NOT RED   R1");
    expect(formatReport(result)).toContain("pins nothing");
  });

  test("a handoff whose test is missing entirely is also not ready", async () => {
    const result = await checkHandoff(
      {
        ...handoff,
        rules: [{ ...handoff.rules[0]!, test: "a test nobody wrote" }],
      },
      {
        readFile: async () => 'test("refuses a raw NUL", () => {});',
        failingTests: async () => [],
      },
    );
    expect(result.bindings[0]?.status).toBe("missing");
    expect(exitCodeFor(result)).toBe(EXIT_NOT_READY);
  });

  test("every rule bound to a failing test is ready", async () => {
    const result = await report(["refuses a raw NUL", "names the line"]);
    expect(result.bindings.every((b) => b.status === "red")).toBe(true);
    expect(exitCodeFor(result)).toBe(0);
  });

  test("the handoff parses from JSON, so the check reads a real file's shape", () => {
    const parsed = parseHandoff(
      JSON.stringify({
        version: 1,
        lane: "OW1",
        files: ["a.test.ts"],
        rules: handoff.rules,
      }),
    );
    expect(parsed.lane).toBe("OW1");
  });
});

describe("§7 control-bytes", () => {
  /** A string carrying one REAL NUL byte, built as bytes rather than as text. */
  const withNul = (before: string, after: string): Uint8Array =>
    new Uint8Array([
      ...Buffer.from(before, "utf8"),
      0x00,
      ...Buffer.from(after, "utf8"),
    ]);

  test("a tracked file holding a raw \\x00 fails the scan", async () => {
    // A raw NUL survived build, typecheck, lint, format and every test at the
    // source. Nothing else in the gate looks at bytes.
    const bytes = withNul('const plan = "docs/pl', 'an.md";\n');
    expect(scanBytes("packages/x/src/PlanCapacity.ts", bytes)).toEqual([
      {
        path: "packages/x/src/PlanCapacity.ts",
        line: 1,
        column: 22,
        byte: 0x00,
      },
    ]);
  });

  test("and the bin exits non-zero, naming the file, line and byte", async () => {
    const logged: string[] = [];
    const errored: string[] = [];
    const code = await controlBytes({
      log: (t) => void logged.push(t),
      logError: (t) => void errored.push(t),
      listFiles: async () => ["packages/x/src/PlanCapacity.ts"],
      readBytes: async () => withNul('const p = "a', 'b";\n'),
      now: () => 0,
    });
    expect(code).toBe(1);
    expect(errored.join("\n")).toContain("packages/x/src/PlanCapacity.ts");
    expect(errored.join("\n")).toContain("NUL");
  });

  test("a clean tree passes, so the failing case above is the scan working", async () => {
    const logged: string[] = [];
    const code = await controlBytes({
      log: (t) => void logged.push(t),
      logError: (t) => void logged.push(t),
      listFiles: async () => ["a.ts"],
      readBytes: async () => new TextEncoder().encode('const p = "ok";\n'),
      now: () => 0,
    });
    expect(code).toBe(0);
    expect(
      controlBytesExit({
        filesScanned: 1,
        filesMissing: [],
        offences: [],
        elapsedMs: 0,
      }),
    ).toBe(0);
  });
});

describe("§7 wave-event", () => {
  test("a non-JSON-object --detail payload exits 2, not silently accepted", async () => {
    for (const detail of ["[]", '"hello"', "1", "null"]) {
      const lines: string[] = [];
      const code = await runWaveEvent(
        ["/logs/w1", "W1", "l1", "gate", "settled", "--detail", detail],
        {
          env: { HOME: "/h" },
          exists: () => false,
          mkdir: async () => {
            throw new Error("must not create a directory for a refused event");
          },
          appendFile: async () => {
            throw new Error("must not append a refused event");
          },
          clock: () => "2026-09-29T00:00:00Z",
          stderr: (l) => void lines.push(l),
        },
      );
      expect(code, detail).toBe(2);
      expect(lines.join("\n"), detail).toContain(
        "--detail must be a JSON object",
      );
    }
  });
});

/** Keeps the file honest about what it imports: reading a real one, not a stub. */
test("the artifact this suite parses is the one the bin writes", async () => {
  const source = await readFile(
    new URL("../src/plan-verify/cli.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain("serializeArtifact");
});
