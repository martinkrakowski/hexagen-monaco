import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  classifyLintRun,
  linterNotFoundOutcome,
  noManifestOutcome,
  parseLintJsonLine,
  toArchValidateJson,
} from "../../../src/commands/arch/validate-outcome.js";

function lintLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    fresh: [],
    baselined: [],
    stale: [],
    expired: [],
    introduced: [],
    baselineGrowth: [],
    filesScanned: 12,
    ...overrides,
  });
}

describe("parseLintJsonLine", () => {
  it("returns null for a malformed JSON line", () => {
    assert.equal(parseLintJsonLine("{not json"), null);
  });

  it("returns null for a line missing fresh", () => {
    const line = lintLine();
    const withoutFresh = line.replace('"fresh":[],', "");
    assert.equal(parseLintJsonLine(withoutFresh), null);
  });
});

describe("classifyLintRun", () => {
  it("exit 0 with a valid line and json true: compliant, with the counts", () => {
    const stdout = lintLine({
      fresh: ["a", "b"],
      expired: ["c"],
      baselineGrowth: [],
      filesScanned: 7,
    });
    const outcome = classifyLintRun(0, stdout, true);
    assert.equal(outcome.status, "compliant");
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(outcome.counts, {
      fresh: 2,
      expired: 1,
      baselineGrowth: 0,
      filesScanned: 7,
    });
    assert.equal(outcome.reason, null);
  });

  it("exit 0 with json true and empty stdout: could-not-run, exitCode 2", () => {
    const outcome = classifyLintRun(0, "", true);
    assert.equal(outcome.status, "could-not-run");
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.counts, null);
  });

  it("exit 0 with json false: compliant, counts null", () => {
    const outcome = classifyLintRun(0, "", false);
    assert.equal(outcome.status, "compliant");
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.counts, null);
  });

  it("exit 1 with a line holding two fresh entries: violations, fresh 2", () => {
    const stdout = lintLine({ fresh: ["a", "b"] });
    const outcome = classifyLintRun(1, stdout, true);
    assert.equal(outcome.status, "violations");
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.counts?.fresh, 2);
  });

  it("exit 1 with no line: could-not-run, exitCode 2", () => {
    const outcome = classifyLintRun(1, "", true);
    assert.equal(outcome.status, "could-not-run");
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.counts, null);
    assert.ok(
      outcome.reason?.includes("exited 1 but printed no readable JSON line"),
    );
  });

  it("exit 1 with an unparseable line: could-not-run, exitCode 2", () => {
    const outcome = classifyLintRun(1, "{not json\n", true);
    assert.equal(outcome.status, "could-not-run");
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.counts, null);
  });

  it("exit 2: could-not-run, the reason contains 'exited 2'", () => {
    const outcome = classifyLintRun(2, "", true);
    assert.equal(outcome.status, "could-not-run");
    assert.equal(outcome.exitCode, 2);
    assert.ok(outcome.reason?.includes("exited 2"));
  });

  it("exit null: could-not-run, the reason mentions the timeout", () => {
    const outcome = classifyLintRun(null, "", true);
    assert.equal(outcome.status, "could-not-run");
    assert.equal(outcome.exitCode, 2);
    assert.ok(outcome.reason?.includes("timeout"));
  });

  it("exit 0 where stdout has log lines before the JSON line: the last { line is used", () => {
    const stdout = [
      "log line one",
      "log line two",
      lintLine({ fresh: ["first"] }),
      "trailing log",
      lintLine({ fresh: ["a", "b", "c"], filesScanned: 9 }),
    ].join("\n");
    const outcome = classifyLintRun(0, stdout, true);
    assert.equal(outcome.status, "compliant");
    assert.equal(outcome.counts?.fresh, 3);
    assert.equal(outcome.counts?.filesScanned, 9);
  });
});

describe("linterNotFoundOutcome", () => {
  it("has exitCode 2", () => {
    const outcome = linterNotFoundOutcome();
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.status, "could-not-run");
    assert.ok(outcome.reason?.includes("not found"));
  });
});

describe("noManifestOutcome", () => {
  it("is could-not-run, exitCode 2, and names the cwd it searched from", () => {
    const outcome = noManifestOutcome("/some/cwd");
    assert.equal(outcome.status, "could-not-run");
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.counts, null);
    assert.equal(
      outcome.reason,
      "no .architecture/manifest.yaml found from /some/cwd",
    );
  });
});

describe("toArchValidateJson", () => {
  it("parses back to exactly the 9 keys in the documented order", () => {
    const outcome = classifyLintRun(0, lintLine(), true);
    const json = toArchValidateJson(outcome);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), [
      "schemaVersion",
      "command",
      "status",
      "exitCode",
      "fresh",
      "expired",
      "baselineGrowth",
      "filesScanned",
      "reason",
    ]);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.command, "arch validate");
    assert.equal(parsed.status, "compliant");
    assert.equal(parsed.exitCode, 0);
    assert.equal(parsed.reason, null);
  });
});
