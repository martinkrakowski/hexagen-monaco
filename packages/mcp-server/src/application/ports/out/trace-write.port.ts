import type { Result } from "@hexagen/shared";
import type { HaltReason } from "../../kernel/trace.js";

export interface TraceAppendToolCall {
  readonly name: string;
  /** Raw call arguments; the adapter digests them, keeping hashing (an I/O
   * concern per the arch linter's application-layer rule) out of application. */
  readonly args: unknown;
  readonly result: unknown;
  readonly time: string;
}

export interface TraceAppendInput {
  readonly grant_id: string;
  readonly goal_id: string;
  readonly tool_call: TraceAppendToolCall;
  readonly halt_reason: HaltReason;
  readonly transaction_ids: readonly string[];
  readonly started_at: string;
  readonly ended_at: string;
}

/**
 * What a successful append reports. `seq` is the line's position in a chained
 * (brownfield) trace; absent when the trace is unchained (greenfield), which
 * has no sequence numbers. A writer with no receipt to give may resolve void
 * (the pre-BW10 shape), which readers treat as no `seq`.
 */
export interface TraceAppendReceipt {
  readonly seq?: number;
}

export interface GrantMissingAppendInput {
  /** The tool the denied call named. */
  readonly tool: string;
  /** Raw call arguments; the adapter digests them. */
  readonly args?: unknown;
  readonly goal_id?: string;
  /** Why the call was denied. */
  readonly reason: string;
  readonly time: string;
}

/**
 * Append-only evidence sink for `.hexagen/evidence/trace.jsonl`. One line
 * per accept or grant-deny at the `hexagen_accept_transaction` choke point
 * — see docs/kernel/TRACE.md. Never rewrites or truncates existing lines.
 */
export interface TraceWritePort {
  appendLine(
    input: TraceAppendInput,
  ): Promise<Result<TraceAppendReceipt | void, Error>>;
  /**
   * Records a call denied for carrying no grant, or a grant with no id, as a
   * `grant_missing` record. Only a chained (brownfield) trace has a place for
   * it; an adapter whose trace is unchained resolves success without writing,
   * so greenfield traces stay byte-identical.
   */
  appendGrantMissing(
    input: GrantMissingAppendInput,
  ): Promise<Result<void, Error>>;
}
