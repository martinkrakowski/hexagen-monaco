/**
 * Domain event announcing that a user discarded a project and started a new
 * one.
 *
 * ANNOUNCEMENT ONLY — publishing this event purges nothing. The purge cascade
 * (wizard draft, editor workspace, governance threads and generation results)
 * is owned by the `discardProject` use case,
 * `apps/web/app/lib/use-cases/project-lifecycle.use-case.ts`, which publishes
 * this event and then performs the purge itself. There are no subscribers.
 *
 * It used to work the other way round: the client composition root
 * (`apps/web/app/lib/wire.client.ts`) subscribed and purged. Because
 * `discardProject` both published the event *and* purged inline, every discard
 * purged chat persistence twice; the subscriber was removed rather than the
 * inline purge. Do not add a purging subscriber — that reintroduces the
 * double purge. Subscribe only to react to the announcement.
 *
 * @see ADR-0029: AI Governance Panel Storage Lifecycle (§1.3–1.4 describe the
 *      original subscriber-driven design, since amended)
 * @see ADR-0051 §Consequences, plan item 5.3(c) — the relocation
 */
export interface ProjectDiscardedEvent {
  /**
   * Unique identifier of the project that was discarded.
   * Scopes the purge that `discardProject` has already performed.
   */
  projectId: string;

  /**
   * Timestamp when the discard action was initiated.
   * Useful for telemetry and audit logging.
   */
  timestamp: Date;

  /**
   * Reason for project discard.
   * - 'user_initiated': User explicitly clicked "Discard and Start New"
   * - 'error': System-initiated discard due to unrecoverable error
   */
  reason: "user_initiated" | "error";
}

/**
 * Event name constant for type-safe event bus operations.
 * Use this when publishing or subscribing to ProjectDiscarded events.
 *
 * Publishing announces a discard; it does not perform one. Callers that mean
 * "discard this project" should call the `discardProject` use case, which
 * publishes this event and owns the purge.
 *
 * @example
 * ```typescript
 * getEventBus().publish({
 *   type: PROJECT_DISCARDED_EVENT,
 *   payload: {
 *     projectId: 'abc-123',
 *     timestamp: new Date(),
 *     reason: 'user_initiated',
 *   },
 *   timestamp: Date.now(),
 *   source: 'useProjectLifecycle',
 * });
 * ```
 */
export const PROJECT_DISCARDED_EVENT = "ProjectDiscarded" as const;

// Made with Bob
