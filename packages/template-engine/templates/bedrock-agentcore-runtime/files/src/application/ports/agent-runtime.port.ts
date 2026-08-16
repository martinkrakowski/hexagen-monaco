/**
 * The contract the AgentCore runtime drives — an application port, not an
 * infrastructure detail (ADR-0053).
 *
 * Implemented by your agent (a LangGraph graph, a tool-calling loop, a single
 * LLM call) and injected into the server: the inbound HTTP adapter depends only
 * on this port, never on a concrete agent, and this module depends on nothing —
 * no transport type, no HTTP envelope, no SDK. `runStream` is optional; when
 * absent, `stream: true` requests fall back to a single `run()` result.
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
