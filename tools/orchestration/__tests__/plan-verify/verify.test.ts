import { describe, expect, test } from "vitest";
import type { Premise } from "../../src/internal/premise-types.js";
import {
  EXIT_ALL_HOLD,
  EXIT_STALE_FOUND,
  EXIT_TIMED_OUT,
  exitCodeFor,
  formatReport,
  verifyPremises,
} from "../../src/plan-verify/lib/verify.js";

const premise = (lane: string, script = "true"): Premise => ({
  plan: "p.md",
  lane,
  script,
});

const execWith =
  (codes: Record<string, number>, output = "") =>
  async (script: string) => ({ exitCode: codes[script] ?? 0, output });

const killed = async (script: string) =>
  script === "hang"
    ? { exitCode: 1, output: "", timedOut: true }
    : { exitCode: 0, output: "", timedOut: false };

describe("verifyPremises", () => {
  test("exit 0 means the gap is still open, so the lane holds", async () => {
    const r = await verifyPremises([premise("W1", "open")], {
      execute: execWith({ open: 0 }),
    });
    expect(r[0]?.status).toBe("holds");
  });

  test("a non-zero exit means the gap is closed and the lane is stale", async () => {
    const r = await verifyPremises([premise("W4", "closed")], {
      execute: execWith({ closed: 1 }),
    });
    expect(r[0]).toMatchObject({ status: "stale", exitCode: 1 });
  });

  test("runs every premise and preserves order", async () => {
    const r = await verifyPremises([premise("A", "a"), premise("B", "b")], {
      execute: execWith({ a: 0, b: 1 }),
    });
    expect(r.map((x) => [x.premise.lane, x.status])).toEqual([
      ["A", "holds"],
      ["B", "stale"],
    ]);
  });

  test("a premise killed by the timeout is timed-out, not holds and not stale", async () => {
    const r = await verifyPremises([premise("W1", "hang")], {
      execute: killed,
    });
    expect(r[0]?.status).toBe("timed-out");
  });

  test("a failed check records the *why* its verdict has none", async () => {
    const r = await verifyPremises([premise("M4", "closed")], {
      execute: execWith({ closed: 1 }, "  already in main  "),
    });
    expect(r[0]?.reason).toBe("already in main");
  });

  test("a holding premise records no reason", async () => {
    const r = await verifyPremises([premise("W1", "open")], {
      execute: execWith({ open: 0 }),
    });
    expect(r[0]).not.toHaveProperty("reason");
  });

  test("an executor that throws is a failed check with a reason, never a crashed run", async () => {
    const r = await verifyPremises(
      [premise("Z9", "boom"), premise("W1", "open")],
      {
        execute: async (script: string) => {
          if (script === "boom") throw new Error("spawn sh ENOENT");
          return { exitCode: 0, output: "" };
        },
      },
    );
    expect(r[0]?.status).toBe("error");
    expect(r[0]?.reason).toContain("spawn sh ENOENT");
    expect(r[1]?.status).toBe("holds");
    expect(exitCodeFor(r)).toBe(EXIT_TIMED_OUT);
  });

  test("a hanging premise does not stop the premises queued after it", async () => {
    const r = await verifyPremises(
      [premise("W1", "hang"), premise("W2", "ok")],
      {
        execute: killed,
      },
    );
    expect(r.map((x) => x.status)).toEqual(["timed-out", "holds"]);
  });
});

describe("formatReport", () => {
  test("names a stale lane, its plan, and says not to dispatch it", async () => {
    const r = await verifyPremises([premise("M4", "closed")], {
      execute: execWith({ closed: 1 }),
    });
    const text = formatReport(r);
    expect(text).toContain("STALE  M4  (p.md)");
    expect(text).toContain("already closed");
    expect(text).toContain("Do not dispatch it");
  });

  test("includes the script's own output when it produced any", async () => {
    const r = await verifyPremises([premise("M4", "closed")], {
      execute: execWith({ closed: 1 }, "already memoized in prepare"),
    });
    expect(formatReport(r)).toContain("already memoized in prepare");
  });

  test("says plainly when nothing is stale", async () => {
    const r = await verifyPremises([premise("W1", "open")], {
      execute: execWith({ open: 0 }),
    });
    expect(formatReport(r)).toBe("1 premise(s) hold; no lane is stale.");
  });

  test("counts both sides when some are stale", async () => {
    const r = await verifyPremises([premise("A", "a"), premise("B", "b")], {
      execute: execWith({ a: 0, b: 1 }),
    });
    expect(formatReport(r)).toContain("1 stale, 1 holding.");
  });

  test("separates the finding block from the summary with a blank line", async () => {
    const r = await verifyPremises([premise("B", "b")], {
      execute: execWith({ b: 1 }),
    });
    expect(formatReport(r)).toContain("\n\n1 stale, 0 holding.");
  });

  test("names a timed-out premise and calls it inconclusive, not stale", async () => {
    const r = await verifyPremises([premise("W1", "hang")], {
      execute: killed,
    });
    const text = formatReport(r);
    expect(text).toContain("TIMED-OUT  W1  (p.md)");
    expect(text).toContain("no verdict");
    expect(text).toContain("may still be live");
    expect(text).not.toContain("Do not dispatch it");
    expect(text).toContain("1 timed out, 0 holding.");
  });

  test("shows a timed-out premise's own output when it produced any", async () => {
    const r = await verifyPremises([premise("W1", "hang")], {
      execute: async () => ({
        exitCode: 1,
        output: "stuck on a network mount",
        timedOut: true,
      }),
    });
    expect(formatReport(r)).toContain("stuck on a network mount");
  });

  test("counts all three outcomes when a run has each", async () => {
    const r = await verifyPremises(
      [premise("A", "a"), premise("B", "b"), premise("H", "hang")],
      {
        execute: async (script: string) =>
          script === "b" ? { exitCode: 1, output: "" } : killed(script),
      },
    );
    expect(formatReport(r)).toContain("1 stale, 1 timed out, 1 holding.");
  });

  test("names an errored premise and says it could not be checked, never to not dispatch", async () => {
    const r = await verifyPremises(
      [premise("Z9", "boom"), premise("W1", "open")],
      {
        execute: async (script: string) => {
          if (script === "boom") throw new Error("spawn sh ENOENT");
          return { exitCode: 0, output: "" };
        },
      },
    );
    const text = formatReport(r);
    expect(text).toContain("ERROR  Z9  (p.md)");
    expect(text).toContain("the premise could not be checked: spawn sh ENOENT");
    expect(text).not.toContain("Do not dispatch it");
    expect(text).toContain("1 error, 1 holding.");
  });
});

describe("exitCodeFor", () => {
  test("is its own code when an executor errors, so CI sees a check that could not decide", async () => {
    const r = await verifyPremises([premise("Z9", "boom")], {
      execute: async () => {
        throw new Error("spawn sh ENOENT");
      },
    });
    expect(exitCodeFor(r)).toBe(EXIT_TIMED_OUT);
  });
  test("is non-zero when any premise is stale, so CI can refuse", async () => {
    const r = await verifyPremises([premise("A", "a"), premise("B", "b")], {
      execute: execWith({ a: 0, b: 1 }),
    });
    expect(exitCodeFor(r)).toBe(EXIT_STALE_FOUND);
  });

  test("is zero when every premise holds", async () => {
    const r = await verifyPremises([premise("A", "a")], {
      execute: execWith({ a: 0 }),
    });
    expect(exitCodeFor(r)).toBe(EXIT_ALL_HOLD);
  });

  test("is its own code when a premise only timed out, so CI sees a check that could not decide", async () => {
    const r = await verifyPremises([premise("H", "hang")], { execute: killed });
    expect(exitCodeFor(r)).toBe(EXIT_TIMED_OUT);
  });

  test("stale outranks a timeout because it is the actionable verdict", async () => {
    const r = await verifyPremises([premise("H", "hang"), premise("B", "b")], {
      execute: async (script: string) =>
        script === "b" ? { exitCode: 1, output: "" } : killed(script),
    });
    expect(exitCodeFor(r)).toBe(EXIT_STALE_FOUND);
  });
});
