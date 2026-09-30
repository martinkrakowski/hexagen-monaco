/**
 * Trace record shape and reader-side validation for the
 * `hexagen_accept_transaction` choke point.
 *
 * Extends the standalone reference in docs/kernel/spike/trace.ts, which
 * checks only the expiry/revocation window (Rules 2 and 3 of
 * docs/kernel/TRACE.md). This module adds the tool-allowlist check the
 * spike explicitly left out pending a Grant with a `tools` field to check
 * against (see docs/kernel/GRANT.md "Acceptance tests": "does not yet
 * cover ... tools ... those are schema-only until the Trace thread gives
 * `id` somewhere to be referenced from").
 *
 * See docs/kernel/trace.schema.json for the wire shape.
 */
import type { Grant } from "./grant.js";

export interface ToolCallRecord {
  readonly name: string;
  readonly args_digest: string;
  readonly result_digest: string;
  readonly time: string;
}

/**
 * Shared vocabulary from docs/kernel/TRACE.md "halt_reason": not a closed
 * enum on the wire (a kit adapter may need its own reasons), but this is
 * what the accept choke point emits.
 */
export type HaltReason =
  | "completed"
  | "grant_denied"
  | "grant_expired"
  | "grant_revoked"
  | "error";

export interface TraceRecord {
  readonly grant_id: string;
  readonly goal_id: string;
  readonly tool_calls: readonly ToolCallRecord[];
  readonly halt_reason: HaltReason;
  readonly transaction_ids: readonly string[];
  readonly started_at: string;
  readonly ended_at: string;
}

export type TraceCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

function isoToMillis(iso: string): number {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) {
    throw new Error(`Not a valid ISO 8601 timestamp: ${iso}`);
  }
  return millis;
}

/**
 * Retrospective validator for a Trace against the Grant(s) it names.
 * Checks, per tool call: the grant_id resolves to a known Grant, the call
 * falls within that grant's expiry/revocation window (docs/kernel/TRACE.md
 * Rules 2 and 3, same at-or-after / strictly-after asymmetry as
 * `checkGrantWindow`), and the call's tool name is one the grant actually
 * allows (docs/kernel/GRANT.md `tools`) — a trace line naming a tool
 * outside `grant.tools` is not valid evidence, whatever the timing.
 */
export function checkTrace(
  trace: TraceRecord,
  grants: readonly Grant[],
): TraceCheck {
  if (!trace.grant_id) {
    return { valid: false, reason: "Trace has no grant_id" };
  }

  const grant = grants.find((candidate) => candidate.id === trace.grant_id);
  if (!grant) {
    return {
      valid: false,
      reason: `Trace grant_id '${trace.grant_id}' matches no known Grant.id`,
    };
  }

  const expiresAt = isoToMillis(grant.expires_at);
  const revokedAt = grant.revoked_at ? isoToMillis(grant.revoked_at) : null;

  for (const call of trace.tool_calls) {
    if (!grant.tools.includes(call.name)) {
      return {
        valid: false,
        reason: `Tool call '${call.name}' is not in grant '${grant.id}' tools`,
      };
    }
    const callTime = isoToMillis(call.time);
    if (revokedAt !== null && callTime >= revokedAt) {
      return {
        valid: false,
        reason: `Tool call '${call.name}' at ${call.time} is at or after grant '${grant.id}' revoked_at (${grant.revoked_at})`,
      };
    }
    if (callTime > expiresAt) {
      return {
        valid: false,
        reason: `Tool call '${call.name}' at ${call.time} is after grant '${grant.id}' expires_at (${grant.expires_at})`,
      };
    }
  }

  return { valid: true };
}
