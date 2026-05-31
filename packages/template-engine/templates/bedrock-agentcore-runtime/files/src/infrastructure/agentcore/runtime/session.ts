import { randomUUID } from "node:crypto";

/**
 * AgentCore Runtime session id + observability correlation.
 *
 * Bedrock AgentCore stamps every invocation with a runtime session id in the
 * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header so multi-turn calls map
 * to one conversation. We surface it as the correlation id so that:
 *   - your application logs, and
 *   - AgentCore's built-in OTEL -> CloudWatch traces
 * share a single id end-to-end.
 *
 * The observability template is a *soft* dependency, so this module must not
 * import it (the file may not exist). Instead it exposes a seam: if
 * observability is installed, register its context runner once at startup —
 *
 *   import { setCorrelationSeeder } from "./infrastructure/agentcore/runtime/session";
 *   import { runWithContext } from "./infrastructure/observability/logging/context";
 *   setCorrelationSeeder((id, fn) => runWithContext({ requestId: id }, fn));
 *
 * Without that wiring, `withSession` is a transparent pass-through and the
 * session id is still threaded explicitly to the agent via `AgentRunInput`.
 */

/** Canonical AgentCore runtime session header (case-insensitive on read). */
export const RUNTIME_SESSION_HEADER =
  "x-amzn-bedrock-agentcore-runtime-session-id";

/**
 * Resolve the conversation/correlation id for an invocation. An explicit
 * `bodySessionId` (from the validated payload) wins; otherwise the runtime
 * session header; otherwise a fresh uuid so every request is still traceable.
 */
export function readSessionId(
  headers: Headers,
  bodySessionId?: string,
): string {
  if (bodySessionId) return bodySessionId;
  return headers.get(RUNTIME_SESSION_HEADER) ?? randomUUID();
}

type CorrelationSeeder = <T>(correlationId: string, fn: () => T) => T;

// Default: no observability installed -> run the handler unchanged.
let seeder: CorrelationSeeder = (_correlationId, fn) => fn();

/**
 * Register the observability context runner (see module docs). Idempotent —
 * the last registration wins, so call it once at startup.
 */
export function setCorrelationSeeder(next: CorrelationSeeder): void {
  seeder = next;
}

/** Run `fn` inside the correlation context seeded from `sessionId`. */
export function withSession<T>(sessionId: string, fn: () => T): T {
  return seeder(sessionId, fn);
}
