import { describe, expect, it } from "vitest";
import {
  traceRuleReasons,
  type TraceRuleLine,
} from "../src/types/trace-rules.js";

const grant = {
  id: "g",
  tools: ["t"],
  expires_at: "2026-12-01T00:00:00.000Z",
};
const WINDOW = "2026-10-01T10:00:00.000Z";
/** A window around WINDOW, as every writer binds it (one instant for all three). */
const wide = {
  started_at: "2026-10-01T09:59:00.000Z",
  ended_at: "2026-10-01T10:01:00.000Z",
};
const line = (
  time: string,
  name = "t",
  halt_reason = "completed",
  over: Partial<TraceRuleLine> = {},
): TraceRuleLine => ({
  grant_id: "g",
  halt_reason,
  tool_calls: [{ name, time }],
  started_at: time,
  ended_at: time,
  ...over,
});
const calls = (...times: string[]): TraceRuleLine["tool_calls"] =>
  times.map((time) => ({ name: "t", time }));

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
      traceRuleReasons({ ...line(WINDOW), grant_id: "z" }, [grant])[0],
    ).toMatch(/matches no known/);
    expect(
      traceRuleReasons({ ...line(WINDOW), grant_id: undefined }, [grant]),
    ).toEqual(["Trace has no grant_id"]);
    expect(
      traceRuleReasons(line("not a time", "t", "completed", wide), [grant])[0],
    ).toMatch(/invalid time/);
  });
});

/**
 * Rule 4 (docs/kernel/TRACE.md): a line's own timestamps have to agree with
 * each other. It compares values inside one line, written by one process, so a
 * denial line gets no exemption from it.
 */
describe("traceRuleReasons — the line's own timeline (Rule 4)", () => {
  it("is valid when every call is inside started_at/ended_at and in order", () => {
    expect(
      traceRuleReasons(
        {
          ...line(WINDOW),
          ...wide,
          tool_calls: calls(wide.started_at, WINDOW, wide.ended_at),
        },
        [grant],
      ),
    ).toEqual([]);
  });

  it("ended_at before started_at is invalid", () => {
    const reversed = {
      started_at: "2026-10-01T10:01:00.000Z",
      ended_at: "2026-10-01T09:59:00.000Z",
    };
    expect(traceRuleReasons({ ...line(WINDOW), ...reversed }, [grant])).toEqual(
      [
        "Trace ended_at (2026-10-01T09:59:00.000Z) is before started_at (2026-10-01T10:01:00.000Z)",
        `Tool call 't' at ${WINDOW} is before started_at (${reversed.started_at})`,
        `Tool call 't' at ${WINDOW} is after ended_at (${reversed.ended_at})`,
      ],
    );
  });

  it("a call before started_at or after ended_at is invalid, and either bound is in", () => {
    const early = traceRuleReasons(
      {
        ...line("2026-10-01T09:58:59.999Z"),
        ...wide,
      },
      [grant],
    );
    expect(early).toEqual([
      `Tool call 't' at 2026-10-01T09:58:59.999Z is before started_at (${wide.started_at})`,
    ]);
    const late = traceRuleReasons(
      {
        ...line("2026-10-01T10:01:00.001Z"),
        ...wide,
      },
      [grant],
    );
    expect(late).toEqual([
      `Tool call 't' at 2026-10-01T10:01:00.001Z is after ended_at (${wide.ended_at})`,
    ]);
    for (const bound of [wide.started_at, wide.ended_at]) {
      expect(traceRuleReasons({ ...line(bound), ...wide }, [grant])).toEqual(
        [],
      );
    }
  });

  it("calls out of order are invalid, and equal times are valid", () => {
    const outOfOrder = traceRuleReasons(
      {
        ...line(WINDOW),
        ...wide,
        tool_calls: calls("2026-10-01T10:00:30.000Z", WINDOW),
      },
      [grant],
    );
    expect(outOfOrder).toEqual([
      "Tool calls are out of order: tool_calls[1] at 2026-10-01T10:00:00.000Z is before tool_calls[0] at 2026-10-01T10:00:30.000Z",
    ]);
    expect(
      traceRuleReasons(
        {
          ...line(WINDOW),
          ...wide,
          tool_calls: calls(WINDOW, WINDOW, WINDOW),
        },
        [grant],
      ),
    ).toEqual([]);
  });

  it("a denial line's timeline is checked too — the rule has no exemption", () => {
    expect(
      traceRuleReasons(
        line(WINDOW, "x", "grant_denied", {
          started_at: "2026-10-01T10:00:00.001Z",
          ended_at: "2026-10-01T10:01:00.000Z",
        }),
        [grant],
      ),
    ).toEqual([
      `Tool call 'x' at ${WINDOW} is before started_at (2026-10-01T10:00:00.001Z)`,
    ]);
  });

  it("a denial outside its grant's window is still valid on that count", () => {
    expect(
      traceRuleReasons(
        line("2026-12-02T00:00:00.000Z", "x", "grant_denied", {
          started_at: "2026-12-01T00:00:00.000Z",
          ended_at: "2026-12-03T00:00:00.000Z",
        }),
        [grant],
      ),
    ).toEqual([]);
  });

  it.each(["completed", "grant_denied"])(
    "a missing or unparsable window is a reason, not a skip, on a %s line",
    (halt_reason) => {
      // The helper binds the window to the call's instant, so breaking one end
      // leaves the other one valid: exactly one reason, never a throw.
      const broken: [Partial<TraceRuleLine>, RegExp][] = [
        [
          { started_at: undefined },
          /^started_at is missing or not a timestamp/,
        ],
        [{ ended_at: undefined }, /^ended_at is missing or not a timestamp/],
        [
          { started_at: "yesterday" },
          /^started_at is missing or not a timestamp/,
        ],
        [{ ended_at: "whenever" }, /^ended_at is missing or not a timestamp/],
      ];
      for (const [over, match] of broken) {
        const reasons = traceRuleReasons(line(WINDOW, "t", halt_reason, over), [
          grant,
        ]);
        expect(reasons, JSON.stringify(over)).toHaveLength(1);
        expect(reasons[0], JSON.stringify(over)).toMatch(match);
      }
    },
  );

  it("a call whose time does not parse is skipped by the order check, not compared", () => {
    expect(
      traceRuleReasons(
        {
          ...line(WINDOW),
          ...wide,
          tool_calls: calls("2026-10-01T10:00:30.000Z", "not a time"),
        },
        [grant],
      ),
    ).toEqual(["Tool call 't' has an invalid time 'not a time'"]);
  });
});
