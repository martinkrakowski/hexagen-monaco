import { z } from "zod";

/**
 * AgentCore Runtime HTTP contract — request/response payloads.
 *
 * Bedrock AgentCore Runtime forwards the caller's JSON body verbatim to
 * `POST /invocations` and expects a JSON (or SSE) response back. This module
 * defines the *Hexagen* envelope that the invocation handler validates against,
 * keeping the inbound adapter's surface explicit and parse-safe — the handler
 * never trusts the raw body.
 */
export const invocationPayloadSchema = z.object({
  /** End-user prompt / instruction for the agent. */
  prompt: z.string().min(1, "prompt must not be empty"),
  /**
   * Opaque per-conversation id. AgentCore also supplies one via the runtime
   * session header; the body value (when present) wins so callers can pin a
   * conversation explicitly. See `readSessionId()`.
   */
  sessionId: z.string().min(1).optional(),
  /** Request a streamed (SSE) response instead of a single JSON envelope. */
  stream: z.boolean().optional(),
  /** Free-form caller context (tenant, locale, feature flags, …). */
  metadata: z.record(z.unknown()).optional(),
});

export type InvocationPayload = z.infer<typeof invocationPayloadSchema>;

/** Success envelope returned to the AgentCore caller. */
export interface InvocationResponse {
  readonly output: string;
  readonly sessionId: string;
  readonly metadata?: Record<string, unknown>;
}

/** Error envelope — AgentCore surfaces the status code; `error` aids debugging. */
export interface InvocationErrorResponse {
  readonly error: string;
  readonly sessionId?: string;
}

/**
 * Application use-case the runtime drives. Implemented by your agent (e.g. a
 * LangGraph graph, a tool-calling loop, a single LLM call) and injected into the
 * server — the inbound HTTP adapter depends only on this port, never on a
 * concrete agent. `runStream` is optional; when absent, `stream: true` requests
 * fall back to a single `run()` result.
 */
export interface AgentRunInput {
  readonly prompt: string;
  readonly sessionId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentRunResult {
  readonly output: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentRuntimePort {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  runStream?(input: AgentRunInput): AsyncIterable<string>;
}
