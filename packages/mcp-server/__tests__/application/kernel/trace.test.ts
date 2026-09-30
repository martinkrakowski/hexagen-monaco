/**
 * Reader-side validator for Trace evidence lines (docs/kernel/TRACE.md).
 * Extends docs/kernel/spike/trace.ts's window check with the tool-allowlist
 * check that spike explicitly deferred to this thread.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { checkTrace } from "../../../src/application/kernel/trace.js";
import {
  MANIFEST_WRITE_PATH,
  type Grant,
} from "../../../src/application/kernel/grant.js";
import type { TraceRecord } from "../../../src/application/kernel/trace.js";

const activeGrant: Grant = {
  id: "grant-001",
  principal: "martin",
  agent: "agent-1",
  contexts: ["billing"],
  paths: [MANIFEST_WRITE_PATH],
  tools: ["hexagen_create_context"],
  mode: "write",
  expires_at: "2026-09-30T12:00:00.000Z",
};

function trace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    grant_id: "grant-001",
    goal_id: "goal-42",
    tool_calls: [
      {
        name: "hexagen_create_context",
        args_digest: "sha256:aaa",
        result_digest: "sha256:bbb",
        time: "2026-09-30T10:00:00.000Z",
      },
    ],
    halt_reason: "completed",
    transaction_ids: ["tx-001"],
    started_at: "2026-09-30T09:59:00.000Z",
    ended_at: "2026-09-30T10:00:05.000Z",
    ...overrides,
  };
}

describe("checkTrace — grant_id resolution (Rule 3)", () => {
  it("is valid when every call is in-tool and in-window", () => {
    assert.equal(checkTrace(trace(), [activeGrant]).valid, true);
  });

  it("is invalid with no grant_id", () => {
    const check = checkTrace(trace({ grant_id: "" }), [activeGrant]);
    assert.equal(check.valid, false);
  });

  it("is invalid when grant_id matches no known Grant", () => {
    const check = checkTrace(trace({ grant_id: "grant-999" }), [activeGrant]);
    assert.equal(check.valid, false);
    if (!check.valid) assert.match(check.reason, /matches no known Grant\.id/);
  });
});

describe("checkTrace — tool allowlist (new: not covered by the spike)", () => {
  it("is invalid when a tool call names a tool outside grant.tools", () => {
    const check = checkTrace(
      trace({
        tool_calls: [
          {
            name: "hexagen_remove_context",
            args_digest: "sha256:aaa",
            result_digest: "sha256:bbb",
            time: "2026-09-30T10:00:00.000Z",
          },
        ],
      }),
      [activeGrant],
    );
    assert.equal(check.valid, false);
    if (!check.valid)
      assert.match(check.reason, /not in grant 'grant-001' tools/);
  });
});

describe("checkTrace — expiry/revocation window (Rule 2)", () => {
  it("is invalid after expires_at", () => {
    const expired: Grant = {
      ...activeGrant,
      expires_at: "2026-09-30T09:00:00.000Z",
    };
    assert.equal(checkTrace(trace(), [expired]).valid, false);
  });

  it("is invalid at or after revoked_at", () => {
    const revoked: Grant = {
      ...activeGrant,
      revoked_at: "2026-09-30T09:30:00.000Z",
    };
    assert.equal(checkTrace(trace(), [revoked]).valid, false);
  });

  it("is valid exactly at expires_at", () => {
    const g: Grant = { ...activeGrant, expires_at: "2026-09-30T10:00:00.000Z" };
    assert.equal(checkTrace(trace(), [g]).valid, true);
  });
});
