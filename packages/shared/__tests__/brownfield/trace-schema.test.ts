import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";

const file = path.resolve(
  __dirname,
  "../../../../docs/kernel/trace.schema.json",
);
const schema = JSON.parse(readFileSync(file, "utf-8"));
const validate = new Ajv({ strict: false, validateFormats: false }).compile(
  schema,
);

const T = "2026-10-01T00:00:00.000Z";
const HEX = "b".repeat(64);

const greenfield = {
  grant_id: "g1",
  goal_id: "goal",
  tool_calls: [
    {
      name: "hexagen_create_context",
      args_digest: "sha256:a",
      result_digest: "sha256:b",
      time: T,
    },
  ],
  halt_reason: "completed",
  transaction_ids: ["t1"],
  started_at: T,
  ended_at: T,
};
const brownfield = { ...greenfield, seq: 0, prev_hash: HEX };
const missing = {
  kind: "grant_missing",
  seq: 1,
  prev_hash: HEX,
  tool: "edit_file",
  reason: "no grant supplied",
  time: T,
};

describe("trace.schema.json", () => {
  it("keeps today's greenfield line valid, unchanged", () => {
    expect(validate(greenfield)).toBe(true);
  });
  it("a greenfield line still forbids extra properties", () => {
    expect(validate({ ...greenfield, extra: 1 })).toBe(false);
    expect(validate({ ...greenfield, grant_id: undefined })).toBe(false);
  });
  it("accepts a brownfield line with seq and prev_hash", () => {
    expect(validate(brownfield)).toBe(true);
  });
  it.each([
    ["seq without prev_hash", { ...greenfield, seq: 0 }],
    ["prev_hash without seq", { ...greenfield, prev_hash: HEX }],
    ["negative seq", { ...brownfield, seq: -1 }],
    ["fractional seq", { ...brownfield, seq: 0.5 }],
    ["short prev_hash", { ...brownfield, prev_hash: "abc" }],
    ["uppercase prev_hash", { ...brownfield, prev_hash: "B".repeat(64) }],
  ])("refuses %s", (_n, line) => {
    expect(validate(line)).toBe(false);
  });
  it("accepts a grant_missing record with no grant_id", () => {
    expect(validate(missing)).toBe(true);
    expect(
      validate({ ...missing, goal_id: "g", args_digest: "sha256:a" }),
    ).toBe(true);
  });
  it.each([
    ["a grant_id", { ...missing, grant_id: "g1" }],
    ["no seq", { ...missing, seq: undefined }],
    ["no prev_hash", { ...missing, prev_hash: undefined }],
    ["no tool", { ...missing, tool: undefined }],
    ["no reason", { ...missing, reason: undefined }],
    ["another kind", { ...missing, kind: "other" }],
  ])("refuses a grant_missing record with %s", (_n, line) => {
    expect(validate(line)).toBe(false);
  });
  it("the Field Kit copy is identical", () => {
    const kit = readFileSync(
      path.resolve(__dirname, "../../../../.hexagen/trace.schema.json"),
      "utf-8",
    );
    expect(kit).toBe(readFileSync(file, "utf-8"));
  });
});
