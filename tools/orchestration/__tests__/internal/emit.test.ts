import { describe, test, expect } from "vitest";
import { formatEvent, appendEvent } from "../../src/internal/emit.js";
import { readEvents } from "../../src/internal/events.js";

const clock = (): string => "2026-09-07T16:55:43Z";

describe("formatEvent (plan §2.1, D103)", () => {
  test("round-trips through W1's readEvents to the same object, stamping ts from the injected clock", () => {
    const input = {
      wave: "S",
      lane: "s4",
      stage: "remediate" as const,
      event: "settled" as const,
      pr: 218,
      round: 1,
      detail: { fixed: 5, refuted: 2, mutations: 3, mutationsBit: 3 },
    };
    const line = formatEvent(input, clock);
    expect(line.endsWith("\n")).toBe(true);
    expect(readEvents(line)).toEqual({
      events: [{ ...input, ts: "2026-09-07T16:55:43Z" }],
      truncated: false,
      rejected: [],
    });
  });

  test("a ts present on the input is kept verbatim, not re-stamped", () => {
    const line = formatEvent(
      {
        ts: "2000-01-01T00:00:00Z",
        wave: "S",
        lane: "s4",
        stage: "dispatch",
        event: "started",
      },
      clock,
    );
    expect(readEvents(line).events[0]?.ts).toBe("2000-01-01T00:00:00Z");
  });

  test("omits the optional fields when absent — nothing is defaulted", () => {
    const line = formatEvent(
      { wave: "S", lane: "s4", stage: "dispatch", event: "started" },
      clock,
    );
    expect(JSON.parse(line)).toEqual({
      ts: "2026-09-07T16:55:43Z",
      wave: "S",
      lane: "s4",
      stage: "dispatch",
      event: "started",
    });
  });

  test("an unknown stage throws with the vocabulary in the message", () => {
    const input = { wave: "S", lane: "s4", stage: "deploy", event: "started" };
    expect(() => formatEvent(input as never, clock)).toThrow(
      /stage is one of: plan-review\|dispatch\|implement\|gate\|review\|remediate\|sweep\|merge\|record/,
    );
  });

  test("an unknown event kind throws with the vocabulary in the message", () => {
    const input = { wave: "S", lane: "s4", stage: "gate", event: "skipped" };
    expect(() => formatEvent(input as never, clock)).toThrow(
      /event is one of: started\|settled\|failed/,
    );
  });
});

describe("appendEvent (the thin impure edge)", () => {
  test("writes formatEvent's line through the injected appendFile, never touching disk itself", async () => {
    const appended: { path: string; data: string }[] = [];
    await appendEvent(
      "/nonexistent/events.jsonl",
      { wave: "S", lane: "s4", stage: "merge", event: "settled" },
      {
        appendFile: async (path, data) => void appended.push({ path, data }),
        clock,
      },
    );
    expect(appended).toEqual([
      {
        path: "/nonexistent/events.jsonl",
        data: formatEvent(
          { wave: "S", lane: "s4", stage: "merge", event: "settled" },
          clock,
        ),
      },
    ]);
  });

  test("an invalid input throws before appendFile is called", async () => {
    let calls = 0;
    await expect(
      appendEvent(
        "/tmp/events.jsonl",
        { wave: "S", lane: "s4", stage: "deploy" } as never,
        {
          appendFile: async () => void calls++,
          clock,
        },
      ),
    ).rejects.toThrow(/invalid wave event/);
    expect(calls).toBe(0);
  });
});

describe("the plan-review stage (FU-plan-review-gate)", () => {
  // The review is emitted once per review, under the reserved lane token `_plan`,
  // and its detail is the reviewer's report: the plan it reviewed, who reviewed,
  // the row fingerprints the reviewer took, the findings counts, and the verdict.
  const detail =
    '{"plan":"docs/planning/p.md","reviewer":"plan-review-seat","rows":{"PT-5a":"aa"},"decisions":{"D177":"bb"},"findings":{"bug":1,"suggestion":2,"nit":3},"applied":1,"refuted":2,"verdict":"clear"}';

  test("formatEvent accepts a plan-review settled event and readEvents round-trips it", () => {
    const input = {
      wave: "platform-and-tenancy-w05",
      lane: "_plan",
      stage: "plan-review" as const,
      event: "settled" as const,
      detail: JSON.parse(detail) as Record<string, unknown>,
    };
    const line = formatEvent(input, clock);
    expect(readEvents(line)).toEqual({
      events: [{ ...input, ts: "2026-09-07T16:55:43Z" }],
      truncated: false,
      rejected: [],
    });
  });

  test("the parity of this line with the shipped bin is asserted in __tests__/bins", () => {
    // The source asserted the same event through `scripts/wave-event.sh`. There
    // is no such script here: wave-event ports to TypeScript (N-7), so that
    // parity is asserted against the bin itself, in the bin's own suite.
    expect(typeof formatEvent).toBe("function");
  });
});
