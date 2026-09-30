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
 * Append-only evidence sink for `.hexagen/evidence/trace.jsonl`. One line
 * per accept or grant-deny at the `hexagen_accept_transaction` choke point
 * — see docs/kernel/TRACE.md. Never rewrites or truncates existing lines.
 */
export interface TraceWritePort {
  appendLine(input: TraceAppendInput): Promise<Result<void>>;
}
