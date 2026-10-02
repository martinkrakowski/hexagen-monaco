import { describe, expect, it } from "vitest";
import { traceRuleReasons } from "../src/types/trace-rules.js";

const grant = {
  id: "g",
  tools: ["t"],
  expires_at: "2026-12-01T00:00:00.000Z",
};
const line = (time: string, name = "t", halt_reason = "completed") => ({
  grant_id: "g",
  halt_reason,
  tool_calls: [{ name, time }],
});

describe("traceRuleReasons", () => {
  it("expires_at is inclusive, one millisecond later is not", () => {
    expect(traceRuleReasons(line("2026-12-01T00:00:00.000Z"), [grant])).toEqual(
      [],
    );
    expect(
      traceRuleReasons(line("2026-12-01T00:00:00.001Z"), [grant]),
    ).toHaveLength(1);
  });
  it("revoked_at is exclusive of the instant itself", () => {
    const g = { ...grant, revoked_at: "2026-10-01T00:00:00.000Z" };
    expect(traceRuleReasons(line("2026-09-30T23:59:59.999Z"), [g])).toEqual([]);
    expect(
      traceRuleReasons(line("2026-10-01T00:00:00.000Z"), [g]),
    ).toHaveLength(1);
  });
  it("the allowlist applies to completed lines only, and accept is implicit", () => {
    expect(
      traceRuleReasons(line("2026-10-01T00:00:00.000Z", "x"), [grant]),
    ).toHaveLength(1);
    expect(
      traceRuleReasons(
        line("2026-10-01T00:00:00.000Z", "hexagen_accept_transaction"),
        [grant],
      ),
    ).toEqual([]);
    expect(
      traceRuleReasons(line("2099-01-01T00:00:00.000Z", "x", "grant_denied"), [
        grant,
      ]),
    ).toEqual([]);
  });
  it("a grant must resolve, denial or not, and bad times are reasons not throws", () => {
    expect(
      traceRuleReasons({ ...line("2026-10-01T00:00:00.000Z"), grant_id: "z" }, [
        grant,
      ])[0],
    ).toMatch(/matches no known/);
    expect(
      traceRuleReasons({ ...line("x"), grant_id: undefined }, [grant]),
    ).toEqual(["Trace has no grant_id"]);
    expect(traceRuleReasons(line("not a time"), [grant])[0]).toMatch(
      /invalid time/,
    );
  });
});
