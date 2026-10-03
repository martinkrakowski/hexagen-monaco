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

/** ISO 8601 with an explicit offset, the form every writer emits. */
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:?\d{2})$/;

/** An instant kept at the precision the timestamp carries. */
interface Instant {
  /** Whole seconds since the epoch, exact. */
  readonly seconds: number;
  /** Fractional-second digits exactly as written ("0009" for `.0009`). */
  readonly fraction: string;
}

/**
 * The instant an ISO-8601 timestamp names, at full precision, or null when the
 * string is not in that form. `Date.parse` keeps milliseconds and drops
 * anything finer, so it reports `…:00.0001Z` and `…:00.0009Z` as the same
 * instant; Rule 4 compares whole seconds and the fractional digits instead.
 */
function exactInstant(iso: string): Instant | null {
  const m = ISO_WITH_OFFSET.exec(iso);
  if (m === null) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = m;
  const at = new Date(0);
  at.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  at.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  let seconds = Math.floor(at.getTime() / 1000);
  if (zone !== "Z" && zone !== "z") {
    const digits = zone.slice(1).replace(":", "");
    const offset =
      Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60;
    seconds -= zone.startsWith("-") ? -offset : offset;
  }
  return { seconds, fraction: fraction ?? "" };
}

/** A parsed timestamp, exact where the string gives the precision to be. */
interface Moment {
  readonly at: number;
  readonly exact: Instant | null;
}

function moment(iso: string | undefined): Moment | null {
  if (iso === undefined) return null;
  const at = millis(iso);
  if (at === null) return null;
  return { at, exact: exactInstant(iso) };
}

/**
 * -1, 0 or 1, at full precision whenever both sides carry an exact instant, so
 * a difference below a millisecond is still a difference and two spellings of
 * the same instant are still equal. Milliseconds otherwise, which is all a
 * timestamp outside the ISO form carries.
 */
function compare(a: Moment, b: Moment): number {
  if (a.exact !== null && b.exact !== null) {
    if (a.exact.seconds !== b.exact.seconds) {
      return a.exact.seconds < b.exact.seconds ? -1 : 1;
    }
    const width = Math.max(a.exact.fraction.length, b.exact.fraction.length);
    const left = a.exact.fraction.padEnd(width, "0");
    const right = b.exact.fraction.padEnd(width, "0");
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return a.at === b.at ? 0 : a.at < b.at ? -1 : 1;
}

/**
 * Rule 4: the line's own timeline has to agree with itself. `ended_at` is not
 * before `started_at`, every call's `time` is inside `[started_at, ended_at]`
 * (both bounds inclusive), and the calls are in time order — equal times are in
 * order. The comparison is inside one line, written by one process, so it
 * applies to a denial line as much as to a completed one. A call whose own
 * `time` does not parse is a reason here, on every line, and is skipped by the
 * comparisons rather than compared as a null; the order check therefore names
 * the last call whose `time` did parse, not simply the one before it.
 */
function timelineReasons(trace: TraceRuleLine): string[] {
  const reasons: string[] = [];
  const startedAt = moment(trace.started_at);
  const endedAt = moment(trace.ended_at);
  if (startedAt === null) {
    reasons.push("started_at is missing or not a timestamp");
  }
  if (endedAt === null) {
    reasons.push("ended_at is missing or not a timestamp");
  }
  if (
    startedAt !== null &&
    endedAt !== null &&
    compare(endedAt, startedAt) < 0
  ) {
    reasons.push(
      `Trace ended_at (${trace.ended_at}) is before started_at (${trace.started_at})`,
    );
  }
  let previous:
    | { readonly index: number; readonly time: string; readonly when: Moment }
    | undefined;
  trace.tool_calls.forEach((call, i) => {
    const when = moment(call.time);
    if (when === null) {
      reasons.push(
        `Tool call '${call.name}' has an invalid time '${call.time}'`,
      );
      return;
    }
    if (startedAt !== null && compare(when, startedAt) < 0) {
      reasons.push(
        `Tool call '${call.name}' at ${call.time} is before started_at (${trace.started_at})`,
      );
    }
    if (endedAt !== null && compare(when, endedAt) > 0) {
      reasons.push(
        `Tool call '${call.name}' at ${call.time} is after ended_at (${trace.ended_at})`,
      );
    }
    if (previous !== undefined && compare(when, previous.when) < 0) {
      reasons.push(
        `Tool calls are out of order: tool_calls[${i}] at ${call.time} is before tool_calls[${previous.index}] at ${previous.time}`,
      );
    }
    previous = { index: i, time: call.time, when };
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
    // An unparsable time is already a reason, from Rule 4's pass; there is
    // nothing here to compare, so the grant window checks are skipped too.
    if (time === null) continue;
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
