/**
 * Outbound port for agent memory — short-term (multi-turn) and long-term
 * (cross-session) recall, keyed by the AgentCore runtime session id.
 *
 * Framework-neutral by design: it speaks domain shapes ({@link MemoryTurn} /
 * {@link MemoryRecord}), never AWS SDK types. An agent use-case can therefore run
 * against AgentCore Memory in production and an in-memory fake in tests without
 * changing a line — the AWS translation lives entirely in the adapter.
 */
export interface MemoryTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
  /** ISO-8601; defaults to now when omitted by the caller. */
  readonly timestamp?: string;
}

export interface MemoryRecord {
  readonly content: string;
  /** Relevance score for semantic recall, when the backing strategy provides one. */
  readonly score?: number;
  /** Strategy that produced this record (e.g. "SEMANTIC", "SUMMARY"). */
  readonly kind?: string;
}

export interface MemoryPort {
  /** Persist a conversation turn for the session (short- and long-term ingestion). */
  store(sessionId: string, turn: MemoryTurn): Promise<void>;
  /** Recall memory relevant to `query` for the session, best-first. */
  retrieve(sessionId: string, query: string, limit?: number): Promise<MemoryRecord[]>;
}
