import { describe, test, expect } from "vitest";
import { readEvents } from "../../src/internal/events.js";

const eventLine = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ts: "2026-09-07T16:55:43Z",
    wave: "S",
    lane: "s4",
    stage: "remediate",
    event: "settled",
    pr: 218,
    round: 1,
    detail: { fixed: 5, refuted: 2, mutations: 3, mutationsBit: 3 },
    ...overrides,
  });

describe("readEvents (plan §2.1)", () => {
  test("parses one JSON object per line, preserving every field", () => {
    const { events, truncated, rejected } = readEvents(`${eventLine()}\n`);
    expect(truncated).toBe(false);
    expect(rejected).toEqual([]);
    expect(events).toEqual([
      {
        ts: "2026-09-07T16:55:43Z",
        wave: "S",
        lane: "s4",
        stage: "remediate",
        event: "settled",
        pr: 218,
        round: 1,
        detail: { fixed: 5, refuted: 2, mutations: 3, mutationsBit: 3 },
      },
    ]);
  });

  test("a truncated final line is dropped as torn, with earlier events intact", () => {
    const text = `${eventLine()}\n${eventLine({ lane: "s3" }).slice(0, -12)}`;
    const { events, truncated, rejected } = readEvents(text);
    expect(truncated).toBe(true);
    expect(rejected).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]?.lane).toBe("s4");
  });

  test("a complete final line without a trailing newline is not torn — it parses and counts", () => {
    const { events, truncated } = readEvents(eventLine({ lane: "s3" }));
    expect(truncated).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.lane).toBe("s3");
  });

  test("a malformed line that carries a trailing newline was written whole — rejected, not torn", () => {
    const { events, truncated, rejected } = readEvents(
      `${eventLine()}\n{"wave":\n`,
    );
    expect(truncated).toBe(false);
    expect(rejected).toEqual(['{"wave":']);
    expect(events).toHaveLength(1);
  });

  test("a malformed middle line lands in rejected with its raw text; later events still parse", () => {
    const text = `${eventLine()}\nnot json at all\n${eventLine({ lane: "s3" })}\n`;
    const { events, truncated, rejected } = readEvents(text);
    expect(truncated).toBe(false);
    expect(rejected).toEqual(["not json at all"]);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.lane)).toEqual(["s4", "s3"]);
  });

  test("an unknown stage is rejected, not coerced", () => {
    const { events, rejected } = readEvents(
      `${eventLine({ stage: "deploy" })}\n`,
    );
    expect(events).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  test("an unknown event kind is rejected, not coerced", () => {
    const { events, rejected } = readEvents(
      `${eventLine({ event: "skipped" })}\n`,
    );
    expect(events).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  test.each(["ts", "wave", "lane", "stage", "event"])(
    "an object missing %s is rejected",
    (field) => {
      const raw = JSON.parse(eventLine()) as Record<string, unknown>;
      delete raw[field];
      const { events, truncated, rejected } = readEvents(
        `${JSON.stringify(raw)}\n`,
      );
      expect(events).toEqual([]);
      expect(truncated).toBe(false);
      expect(rejected).toHaveLength(1);
    },
  );

  test("a line that parses but is not an object is rejected", () => {
    const { events, rejected, truncated } = readEvents(
      '[1, 2]\n"wave"\n42\ntrue\nnull\n',
    );
    expect(truncated).toBe(false);
    expect(rejected).toEqual(["[1, 2]", '"wave"', "42", "true", "null"]);
    expect(events).toEqual([]);
  });

  test("optional fields may be omitted — they are not defaulted", () => {
    const line = JSON.stringify({
      ts: "2026-09-07T16:55:43Z",
      wave: "S",
      lane: "s4",
      stage: "dispatch",
      event: "started",
    });
    const { events, rejected } = readEvents(`${line}\n`);
    expect(rejected).toEqual([]);
    expect(events).toEqual([
      {
        ts: "2026-09-07T16:55:43Z",
        wave: "S",
        lane: "s4",
        stage: "dispatch",
        event: "started",
      },
    ]);
  });

  test("optional round and detail are type-checked, not coerced", () => {
    const badRound = eventLine({ round: "1" });
    const badDetail = eventLine({ detail: "nope" });
    const nullDetail = eventLine({ detail: null });
    const arrayDetail = eventLine({ detail: [1] });
    const { events, rejected } = readEvents(
      `${badRound}\n${badDetail}\n${nullDetail}\n${arrayDetail}\n${eventLine()}\n`,
    );
    expect(rejected).toHaveLength(4);
    expect(events).toHaveLength(1);
    expect(events[0]?.round).toBe(1);
  });

  test("a torn final line that happens to be valid JSON but not a valid event is rejected, not torn", () => {
    const { events, truncated, rejected } = readEvents(
      `${eventLine()}\n{"foo": 1}`,
    );
    expect(truncated).toBe(false);
    expect(rejected).toEqual(['{"foo": 1}']);
    expect(events).toHaveLength(1);
  });

  test("optional numeric fields are type-checked, not coerced", () => {
    const { events, rejected } = readEvents(
      `${eventLine({ pr: "218" })}\n${eventLine()}\n`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.pr).toBe(218);
    expect(rejected).toHaveLength(1);
  });

  test("blank lines are noise, neither events nor rejections", () => {
    const { events, truncated, rejected } = readEvents(`\n${eventLine()}\n\n`);
    expect(events).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(rejected).toEqual([]);
  });

  test("empty text is an empty, healthy log", () => {
    expect(readEvents("")).toEqual({
      events: [],
      truncated: false,
      rejected: [],
    });
  });
});

describe("F20: the repo field is optional on read", () => {
  const base = '"ts":"2026-09-29T00:00:00Z","wave":"W3"';
  const tail = '"lane":"l1","stage":"dispatch","event":"started"';

  test("a legacy line without repo still parses", () => {
    const { events, rejected } = readEvents(`{${base},${tail}}\n`);
    expect(rejected).toEqual([]);
    expect(events[0]?.repo).toBeUndefined();
  });

  test("a line with repo parses and keeps it", () => {
    const { events } = readEvents(`{${base},"repo":"acme/demo",${tail}}\n`);
    expect(events[0]?.repo).toBe("acme/demo");
  });

  test("a non-string repo is rejected", () => {
    const { events, rejected } = readEvents(`{${base},"repo":7,${tail}}\n`);
    expect(events).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
});
