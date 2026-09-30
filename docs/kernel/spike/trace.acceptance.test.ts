/**
 * Acceptance tests for the Trace kernel object spec (docs/kernel/TRACE.md).
 *
 * These exercise the standalone reference module `trace.ts` (same
 * directory, docs/kernel/spike/) —
 * not any wiring into a running tool, the CLI, or the accept-transaction
 * flow — that wiring does not exist yet. What these tests establish is
 * the contract a future `hexagen evidence pack` must satisfy: the three
 * fail-closed Rules in TRACE.md, checked retrospectively against a Trace
 * and the Grant(s) it names.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  checkTrace,
  type GrantRef,
  type Trace,
} from "./trace.js";

const activeGrant: GrantRef = {
  id: "grant-001",
  expires_at: "2026-09-30T12:00:00.000Z",
};

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    grant_id: "grant-001",
    goal_id: "goal-42",
    tool_calls: [
      {
        name: "hexagen_create_port",
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

describe("checkTrace — Rule 3: a Trace without a matching Grant.id is invalid", () => {
  it("is valid when grant_id matches a known grant and every call is within its window", () => {
    const check = checkTrace(trace(), [activeGrant]);
    assert.equal(check.valid, true);
  });

  it("is invalid when grant_id is empty", () => {
    const check = checkTrace(trace({ grant_id: "" }), [activeGrant]);
    assert.equal(check.valid, false);
    if (!check.valid) assert.match(check.reason, /no grant_id/);
  });

  it("is invalid when grant_id matches no supplied grant — never invents a second identity", () => {
    const check = checkTrace(trace({ grant_id: "grant-999" }), [activeGrant]);
    assert.equal(check.valid, false);
    if (!check.valid) {
      assert.match(check.reason, /matches no known Grant\.id/);
    }
  });
});

describe("checkTrace — Rule 2: a write whose grant is expired or revoked is fail closed", () => {
  it("is invalid when a tool call happened after the grant's expires_at", () => {
    const expired: GrantRef = { id: "grant-001", expires_at: "2026-09-30T09:00:00.000Z" };
    const check = checkTrace(trace(), [expired]);
    assert.equal(check.valid, false);
    if (!check.valid) assert.match(check.reason, /after grant 'grant-001' expires_at/);
  });

  it("is invalid when a tool call happened at or after the grant's revoked_at", () => {
    const revoked: GrantRef = {
      id: "grant-001",
      expires_at: "2026-09-30T12:00:00.000Z",
      revoked_at: "2026-09-30T09:30:00.000Z",
    };
    const check = checkTrace(trace(), [revoked]);
    assert.equal(check.valid, false);
    if (!check.valid) assert.match(check.reason, /revoked_at/);
  });

  it("a call exactly at revoked_at is still denied (at-or-after, not strictly-after)", () => {
    const revoked: GrantRef = {
      id: "grant-001",
      expires_at: "2026-09-30T12:00:00.000Z",
      revoked_at: "2026-09-30T10:00:00.000Z",
    };
    const check = checkTrace(trace(), [revoked]);
    assert.equal(check.valid, false);
  });

  it("a call exactly at expires_at is still allowed (at-or-before is in-window)", () => {
    const grant: GrantRef = { id: "grant-001", expires_at: "2026-09-30T10:00:00.000Z" };
    const check = checkTrace(trace(), [grant]);
    assert.equal(check.valid, true);
  });
});

describe("checkTrace — ordered tool calls, multiple grants", () => {
  it("checks every call, not just the first", () => {
    const t = trace({
      tool_calls: [
        {
          name: "hexagen_create_port",
          args_digest: "sha256:aaa",
          result_digest: "sha256:bbb",
          time: "2026-09-30T09:00:00.000Z",
        },
        {
          name: "hexagen_accept_transaction",
          args_digest: "sha256:ccc",
          result_digest: "sha256:ddd",
          time: "2026-09-30T13:00:00.000Z",
        },
      ],
    });
    const check = checkTrace(t, [activeGrant]);
    assert.equal(check.valid, false);
    if (!check.valid) {
      assert.match(check.reason, /hexagen_accept_transaction/);
    }
  });

  it("selects the right grant among several by id", () => {
    const other: GrantRef = { id: "grant-002", expires_at: "2020-01-01T00:00:00.000Z" };
    const check = checkTrace(trace(), [other, activeGrant]);
    assert.equal(check.valid, true);
  });
});
