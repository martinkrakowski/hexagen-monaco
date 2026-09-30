/**
 * Reference implementation backing docs/kernel/TRACE.md.
 *
 * Deliberately standalone, matching how grant.ts (same directory) was
 * left: no `fs`, no dependency on any `application`/`infrastructure` port
 * in `@hexagen/mcp-server`, not wired into any running tool, the CLI, or
 * the accept-transaction flow. Lives under `docs/kernel/spike/`, outside
 * `packages/mcp-server/src` and its barrel — mcp-server does not import
 * it. It exists so the acceptance tests in `trace.acceptance.test.ts` have
 * something executable to run against — the logic `hexagen evidence pack`
 * would run once built.
 *
 * Does not redefine Grant. `GrantRef` below is the minimal shape this
 * module needs to check the three Rules in TRACE.md (id, expires_at,
 * revoked_at) — the full Grant schema lives in grant.schema.json /
 * grant.ts and is not reproduced here.
 *
 * See docs/kernel/trace.schema.json for the wire shape this mirrors.
 */

/** The minimal slice of a Grant this module needs to reference. */
export interface GrantRef {
  readonly id: string;
  readonly expires_at: string;
  readonly revoked_at?: string;
}

export interface ToolCallRecord {
  readonly name: string;
  readonly args_digest: string;
  readonly result_digest: string;
  readonly time: string;
}

export interface Trace {
  readonly grant_id: string;
  readonly goal_id: string;
  readonly tool_calls: readonly ToolCallRecord[];
  readonly halt_reason: string;
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
 * Retrospective validator for the three fail-closed Rules in TRACE.md.
 * `grants` is every Grant known to the caller (typically one, but a
 * multi-grant evidence pack is plausible) — `trace.grant_id` must match
 * exactly one of them by `id`.
 */
export function checkTrace(
  trace: Trace,
  grants: readonly GrantRef[],
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
