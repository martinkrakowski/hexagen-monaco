/**
 * The pure reader-side rules of docs/kernel/TRACE.md (Rules 1-3, the tool
 * allowlist and the denial exemption), written once. The MCP server's
 * `checkTrace` and `hexagen evidence pack` both call it, so the two cannot
 * drift. Node-free; the grant and line shapes are structural so no `Grant`
 * type is defined here.
 */

export interface TraceRuleGrant {
  readonly id: string;
  readonly tools: readonly string[];
  readonly expires_at: string;
  readonly revoked_at?: string;
}

export interface TraceRuleLine {
  readonly grant_id?: string;
  readonly halt_reason: string;
  readonly tool_calls: readonly {
    readonly name: string;
    readonly time: string;
  }[];
}

/**
 * `hexagen_accept_transaction` is never listed in `grant.tools`: grants name the
 * mutation tools they authorize, not the accept step that carries them.
 */
export const IMPLICITLY_ALLOWED_TOOL = "hexagen_accept_transaction";

function millis(iso: string): number | null {
  const m = Date.parse(iso);
  return Number.isNaN(m) ? null : m;
}

/**
 * Every reason `trace` is invalid against `grants`; empty means valid. The
 * grant must resolve for every line. A line whose `halt_reason` is not
 * "completed" documents a refused attempt, so the allowlist and window checks
 * are skipped for it: its tool or time being outside the grant is exactly why
 * it was refused. A call exactly at `expires_at` is in-window; at or after
 * `revoked_at` is not.
 */
export function traceRuleReasons(
  trace: TraceRuleLine,
  grants: readonly TraceRuleGrant[],
): string[] {
  if (!trace.grant_id) return ["Trace has no grant_id"];
  const grant = grants.find((g) => g.id === trace.grant_id);
  if (!grant) {
    return [`Trace grant_id '${trace.grant_id}' matches no known Grant.id`];
  }
  if (trace.halt_reason !== "completed") return [];

  const expiresAt = millis(grant.expires_at);
  const revokedAt = grant.revoked_at ? millis(grant.revoked_at) : null;
  if (expiresAt === null || (grant.revoked_at && revokedAt === null)) {
    return [`grant '${grant.id}' has an invalid expires_at or revoked_at`];
  }
  const reasons: string[] = [];
  for (const call of trace.tool_calls) {
    if (
      call.name !== IMPLICITLY_ALLOWED_TOOL &&
      !grant.tools.includes(call.name)
    ) {
      reasons.push(
        `Tool call '${call.name}' is not in grant '${grant.id}' tools`,
      );
    }
    const time = millis(call.time);
    if (time === null) {
      reasons.push(
        `Tool call '${call.name}' has an invalid time '${call.time}'`,
      );
      continue;
    }
    if (revokedAt !== null && time >= revokedAt) {
      reasons.push(
        `Tool call '${call.name}' at ${call.time} is at or after grant '${grant.id}' revoked_at (${grant.revoked_at})`,
      );
    }
    if (time > expiresAt) {
      reasons.push(
        `Tool call '${call.name}' at ${call.time} is after grant '${grant.id}' expires_at (${grant.expires_at})`,
      );
    }
  }
  return reasons;
}
