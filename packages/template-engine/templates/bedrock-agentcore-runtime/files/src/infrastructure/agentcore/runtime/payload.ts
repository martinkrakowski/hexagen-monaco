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

// The port the runtime drives (`AgentRuntimePort` and its `AgentRunInput` /
// `AgentRunResult` companions) is NOT declared here: it is an application
// contract and lives at `src/application/ports/agent-runtime.port.ts`
// (ADR-0053). What stays in this module is the HTTP wire envelope above, which
// is infrastructure by definition.
