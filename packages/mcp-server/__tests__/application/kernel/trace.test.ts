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
import type {
  GrantMissingRecord,
  GreenfieldTraceRecord,
  TraceRecord,
} from "../../../src/application/kernel/trace.js";

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

function trace(
  overrides: Partial<GreenfieldTraceRecord> = {},
): GreenfieldTraceRecord {
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

describe("checkTrace — non-completed records document a refused attempt", () => {
  it("is valid for a grant_denied record even though its tool is outside grant.tools", () => {
    const check = checkTrace(
      trace({
        halt_reason: "grant_denied",
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
    assert.equal(check.valid, true);
  });

  it("is valid for a grant_expired record even though its call time is after expires_at", () => {
    const expired: Grant = {
      ...activeGrant,
      expires_at: "2026-09-30T09:00:00.000Z",
    };
    const check = checkTrace(trace({ halt_reason: "grant_expired" }), [
      expired,
    ]);
    assert.equal(check.valid, true);
  });

  it("still requires grant_id to resolve, even for a non-completed record", () => {
    const check = checkTrace(
      trace({ halt_reason: "error", grant_id: "grant-999" }),
      [activeGrant],
    );
    assert.equal(check.valid, false);
  });
});

describe("checkTrace — hexagen_accept_transaction is implicitly allowed", () => {
  it("is valid for a completed, mutation-less accept naming a tool not in grant.tools", () => {
    const check = checkTrace(
      trace({
        tool_calls: [
          {
            name: "hexagen_accept_transaction",
            args_digest: "sha256:aaa",
            result_digest: "sha256:bbb",
            time: "2026-09-30T10:00:00.000Z",
          },
        ],
      }),
      [activeGrant],
    );
    assert.equal(check.valid, true);
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

describe("brownfield trace types (types only, no behaviour)", () => {
  it("a chained line is still checked exactly like a greenfield one", () => {
    const chained: TraceRecord = {
      ...trace(),
      seq: 0,
      prev_hash: "0".repeat(64),
    };
    assert.deepEqual(checkTrace(chained, [activeGrant]), { valid: true });
  });

  it("seq and prev_hash are both present or both absent (type level)", () => {
    // @ts-expect-error seq without prev_hash is not a TraceRecord
    const onlySeq: TraceRecord = { ...trace(), seq: 0 };
    // @ts-expect-error prev_hash without seq is not a TraceRecord
    const onlyPrev: TraceRecord = { ...trace(), prev_hash: "0".repeat(64) };
    assert.ok(onlySeq && onlyPrev);
  });

  it("a grant_missing record carries no grant_id", () => {
    const record: GrantMissingRecord = {
      kind: "grant_missing",
      seq: 1,
      prev_hash: "0".repeat(64),
      tool: "edit_file",
      reason: "no grant supplied",
      time: "2026-09-30T11:00:00.000Z",
    };
    assert.equal("grant_id" in record, false);
  });
});
