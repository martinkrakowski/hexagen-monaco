import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";

describe("canonicalGrantPayload (sync's copy)", () => {
  it("matches the pinned shape packages/mcp-server's canonicalGrantPayload produces for the same fields — keys sorted, undefined fields dropped", () => {
    const payload = canonicalGrantPayload({
      id: "g1",
      principal: "martin",
      agent: "a1",
      contexts: ["billing"],
      paths: [".architecture/"],
      tools: ["hexagen_create_context"],
      mode: "write",
      expires_at: "2026-09-30T18:00:00.000Z",
    });
    assert.equal(
      payload,
      '{"agent":"a1","contexts":["billing"],"expires_at":"2026-09-30T18:00:00.000Z","id":"g1","mode":"write","paths":[".architecture/"],"principal":"martin","tools":["hexagen_create_context"]}',
    );
  });

  it("is stable across different property insertion orders", () => {
    const a = canonicalGrantPayload({
      id: "g1",
      principal: "martin",
      agent: "a1",
      contexts: ["billing"],
      paths: [".architecture/"],
      tools: ["hexagen_create_context"],
      mode: "write",
      expires_at: "2026-09-30T18:00:00.000Z",
    });
    const b = canonicalGrantPayload({
      expires_at: "2026-09-30T18:00:00.000Z",
      mode: "write",
      tools: ["hexagen_create_context"],
      paths: [".architecture/"],
      contexts: ["billing"],
      agent: "a1",
      principal: "martin",
      id: "g1",
    });
    assert.equal(a, b);
  });

  it("changes when any signable field changes", () => {
    const base = {
      id: "g1",
      principal: "martin",
      agent: "a1",
      contexts: ["billing"],
      paths: [".architecture/"],
      tools: ["hexagen_create_context"],
      mode: "write" as const,
      expires_at: "2026-09-30T18:00:00.000Z",
    };
    const a = canonicalGrantPayload(base);
    const b = canonicalGrantPayload({ ...base, contexts: ["stripe"] });
    assert.notEqual(a, b);
  });

  it("includes max_files and revoked_at only when set", () => {
    const base = {
      id: "g1",
      principal: "martin",
      agent: "a1",
      contexts: ["billing"],
      paths: [".architecture/"],
      tools: ["hexagen_create_context"],
      mode: "write" as const,
      expires_at: "2026-09-30T18:00:00.000Z",
    };
    assert.ok(!canonicalGrantPayload(base).includes("max_files"));
    assert.ok(!canonicalGrantPayload(base).includes("revoked_at"));
    assert.ok(
      canonicalGrantPayload({ ...base, max_files: 4 }).includes(
        '"max_files":4',
      ),
    );
    assert.ok(
      canonicalGrantPayload({
        ...base,
        revoked_at: "2026-09-30T19:00:00.000Z",
      }).includes("revoked_at"),
    );
  });
});
