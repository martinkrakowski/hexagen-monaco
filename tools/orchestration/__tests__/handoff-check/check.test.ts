import { describe, expect, test } from "vitest";
import {
  EXIT_NOT_READY,
  EXIT_READY,
  checkHandoff,
  exitCodeFor,
  formatReport,
} from "../../src/handoff-check/lib/check.js";
import type {
  Handoff,
  HandoffDeps,
} from "../../src/handoff-check/lib/types.js";

const handoff = (rules: Handoff["rules"]): Handoff => ({
  version: 1,
  lane: "W1",
  files: ["a.test.ts"],
  rules,
});

const RULE = {
  id: "conflict",
  statement: "disagreements win",
  test: "conflict wins",
};

const deps = (source: string, failing: readonly string[]): HandoffDeps => ({
  readFile: async () => source,
  failingTests: async () => failing,
});

const SRC = `test("conflict wins", () => {}); test("stray", () => {});`;

describe("checkHandoff", () => {
  test("a rule whose test exists and fails is red — ready for stage 2", async () => {
    const r = await checkHandoff(handoff([RULE]), deps(SRC, ["conflict wins"]));
    expect(r.bindings[0]?.status).toBe("red");
    expect(exitCodeFor(r)).toBe(EXIT_READY);
  });

  test("a rule naming a test that does not exist is missing", async () => {
    const r = await checkHandoff(
      handoff([{ ...RULE, test: "absent" }]),
      deps(SRC, []),
    );
    expect(r.bindings[0]?.status).toBe("missing");
    expect(exitCodeFor(r)).toBe(EXIT_NOT_READY);
  });

  test("a rule whose test already passes pins nothing", async () => {
    const r = await checkHandoff(handoff([RULE]), deps(SRC, []));
    expect(r.bindings[0]?.status).toBe("passing");
    expect(exitCodeFor(r)).toBe(EXIT_NOT_READY);
  });

  test("reports tests no rule claims, without failing on them", async () => {
    const r = await checkHandoff(handoff([RULE]), deps(SRC, ["conflict wins"]));
    expect(r.unclaimed).toEqual(["stray"]);
    expect(exitCodeFor(r)).toBe(EXIT_READY);
  });

  test("reads every declared file", async () => {
    const seen: string[] = [];
    const r = await checkHandoff(
      { ...handoff([RULE]), files: ["a.test.ts", "b.test.ts"] },
      {
        readFile: async (p) => {
          seen.push(p);
          return p === "b.test.ts" ? SRC : "";
        },
        failingTests: async () => ["conflict wins"],
      },
    );
    expect(seen).toEqual(["a.test.ts", "b.test.ts"]);
    expect(r.bindings[0]?.status).toBe("red");
  });

  test("one unready rule among several is enough to hold the handoff", async () => {
    const r = await checkHandoff(
      handoff([RULE, { id: "b", statement: "s", test: "absent" }]),
      deps(SRC, ["conflict wins"]),
    );
    expect(exitCodeFor(r)).toBe(EXIT_NOT_READY);
  });
});

describe("formatReport", () => {
  test("says a missing test would be silently left out by stage 2", async () => {
    const r = await checkHandoff(
      handoff([{ ...RULE, test: "absent" }]),
      deps(SRC, []),
    );
    const t = formatReport(r);
    expect(t).toContain("NO TEST   conflict");
    expect(t).toContain("disagreements win");
    expect(t).toContain("coverage would not show the gap");
  });

  test("says a passing test could be satisfied by changing nothing", async () => {
    const t = formatReport(await checkHandoff(handoff([RULE]), deps(SRC, [])));
    expect(t).toContain("NOT RED   conflict");
    expect(t).toContain("changing nothing at all");
  });

  test("lists unclaimed tests as worth a look rather than a failure", async () => {
    const t = formatReport(
      await checkHandoff(handoff([RULE]), deps(SRC, ["conflict wins"])),
    );
    expect(t).toContain("Unclaimed tests");
    expect(t).toContain("- stray");
  });

  test("declares the handoff ready when every rule is bound to a failing test", async () => {
    const r = await checkHandoff(
      handoff([RULE]),
      deps(`test("conflict wins", () => {})`, ["conflict wins"]),
    );
    expect(formatReport(r)).toBe(
      "W1: 1 rule(s), each bound to a failing test. Ready for stage 2.",
    );
  });

  test("counts how many rules are not ready", async () => {
    const r = await checkHandoff(
      handoff([RULE, { id: "b", statement: "s", test: "absent" }]),
      deps(SRC, ["conflict wins"]),
    );
    expect(formatReport(r)).toContain("W1: 1 of 2 rule(s) not ready.");
  });
});
