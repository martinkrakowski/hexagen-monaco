/**
 * The pure reader-side rules of docs/kernel/TRACE.md (Rules 1-4, the tool
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
  /** Optional on the type, required by Rule 4: a line that omits one, or
   *  carries one that does not parse, is a reason, not a skip. */
  readonly started_at?: string;
  readonly ended_at?: string;
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
 * Rule 4: the line's own timeline has to agree with itself. `ended_at` is not
 * before `started_at`, every call's `time` is inside `[started_at, ended_at]`
 * (both bounds inclusive), and the calls are in time order — equal times are in
 * order. The comparison is inside one line, written by one process, so it
 * applies to a denial line as much as to a completed one; a call whose own
 * `time` does not parse is left to the caller's invalid-time reason rather
 * than compared.
 */
function timelineReasons(trace: TraceRuleLine): string[] {
  const reasons: string[] = [];
  const startedAt =
    trace.started_at === undefined ? null : millis(trace.started_at);
  const endedAt = trace.ended_at === undefined ? null : millis(trace.ended_at);
  if (startedAt === null) {
    reasons.push("started_at is missing or not a timestamp");
  }
  if (endedAt === null) {
    reasons.push("ended_at is missing or not a timestamp");
  }
  if (startedAt !== null && endedAt !== null && endedAt < startedAt) {
    reasons.push(
      `Trace ended_at (${trace.ended_at}) is before started_at (${trace.started_at})`,
    );
  }
  let previous: { readonly time: string; readonly at: number } | undefined;
  trace.tool_calls.forEach((call, i) => {
    const time = millis(call.time);
    if (time === null) return;
    if (startedAt !== null && time < startedAt) {
      reasons.push(
        `Tool call '${call.name}' at ${call.time} is before started_at (${trace.started_at})`,
      );
    }
    if (endedAt !== null && time > endedAt) {
      reasons.push(
        `Tool call '${call.name}' at ${call.time} is after ended_at (${trace.ended_at})`,
      );
    }
    if (previous !== undefined && time < previous.at) {
      reasons.push(
        `Tool calls are out of order: tool_calls[${i}] at ${call.time} is before tool_calls[${i - 1}] at ${previous.time}`,
      );
    }
    previous = { time: call.time, at: time };
  });
  return reasons;
}

/**
 * Every reason `trace` is invalid against `grants`; empty means valid. The
 * grant must resolve for every line. The line's own timeline (Rule 4) is
 * checked before anything else a line carries, denial lines included. A line
 * whose `halt_reason` is not "completed" documents a refused attempt, so the
 * allowlist and grant-window checks are skipped for it: its tool or time being
 * outside the grant is exactly why it was refused. A call exactly at
 * `expires_at` is in-window; at or after `revoked_at` is not.
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
  const reasons = timelineReasons(trace);
  if (trace.halt_reason !== "completed") return reasons;

  const expiresAt = millis(grant.expires_at);
  const revokedAt = grant.revoked_at ? millis(grant.revoked_at) : null;
  if (expiresAt === null || (grant.revoked_at && revokedAt === null)) {
    return [
      `grant '${grant.id}' has an invalid expires_at or revoked_at`,
      ...reasons,
    ];
  }
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
