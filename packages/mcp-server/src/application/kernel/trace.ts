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
import { traceRuleReasons } from "@hexagen/shared";
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

interface TraceLineFields {
  readonly grant_id: string;
  readonly goal_id: string;
  readonly tool_calls: readonly ToolCallRecord[];
  readonly halt_reason: HaltReason;
  readonly transaction_ids: readonly string[];
  readonly started_at: string;
  readonly ended_at: string;
}

/** Greenfield line: no chain fields. */
export interface GreenfieldTraceRecord extends TraceLineFields {
  readonly seq?: undefined;
  readonly prev_hash?: undefined;
}

/**
 * Brownfield line (docs/kernel/trace.schema.json `brownfield_line`): `seq` and
 * `prev_hash` chain it to the line before it. `TraceWriteAdapter` fills them in
 * brownfield mode; `checkTrace` ignores them (the chain is verified by
 * `hexagen evidence pack`).
 */
export interface ChainedTraceRecord extends TraceLineFields {
  readonly seq: number;
  readonly prev_hash: string;
}

/** `seq` and `prev_hash` are both present or both absent. */
export type TraceRecord = GreenfieldTraceRecord | ChainedTraceRecord;

/**
 * A denied call that carried no grant, or a grant with no id. It has no
 * `grant_id` to cite, so it is its own record kind (schema `grant_missing`),
 * never evidence of a write. Written by `TraceWriteAdapter.appendGrantMissing`
 * in brownfield mode only.
 */
export interface GrantMissingRecord {
  readonly kind: "grant_missing";
  readonly seq: number;
  readonly prev_hash: string;
  readonly goal_id?: string;
  readonly tool: string;
  readonly args_digest?: string;
  readonly reason: string;
  readonly time: string;
}

export type TraceCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

/**
 * Retrospective validator for a Trace against the Grant(s) it names.
 * Checks that the grant_id resolves to a known Grant, that each record's own
 * timeline holds — `started_at`, `ended_at` and the order of its
 * `tool_calls`, under docs/kernel/TRACE.md Rule 4, for every record and
 * denial lines included — and — only for a record whose `halt_reason` is
 * "completed" — that each call falls within that grant's expiry/revocation
 * window (docs/kernel/TRACE.md Rules 2 and 3) and names a tool the grant
 * allows (docs/kernel/GRANT.md `tools`). A record with any other halt_reason
 * documents a refused attempt, not an authorized write — the mutation's tool
 * being outside `grant.tools`, or the grant being expired or revoked, is
 * exactly why it was refused, so those two checks would otherwise reject the
 * evidence of every denial they are supposed to explain.
 */
export function checkTrace(
  trace: TraceRecord,
  grants: readonly Grant[],
): TraceCheck {
  const [reason] = traceRuleReasons(trace, grants);
  return reason === undefined ? { valid: true } : { valid: false, reason };
}
