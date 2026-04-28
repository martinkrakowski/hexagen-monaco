/**
 * Domain event emitted when a user discards a project and starts a new one.
 *
 * This event triggers cleanup of all project-scoped persistence:
 * - Wizard drafts in IndexedDB
 * - Chat threads in IndexedDB
 * - Editor workspace state
 * - Canvas layout preferences
 *
 * Subscribers (adapters) handle the actual cleanup implementation,
 * maintaining the boundary between domain intent and infrastructure.
 *
 * @see ADR-0029: AI Governance Panel Storage Lifecycle
 */
export interface ProjectDiscardedEvent {
  /**
   * Unique identifier of the project being discarded.
   * Used to scope cleanup operations in persistence adapters.
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
 * Use this when emitting or subscribing to ProjectDiscarded events.
 *
 * @example
 * ```typescript
 * getEventBus().emit(PROJECT_DISCARDED_EVENT, {
 *   projectId: 'abc-123',
 *   timestamp: new Date(),
 *   reason: 'user_initiated'
 * });
 * ```
 */
export const PROJECT_DISCARDED_EVENT = "ProjectDiscarded" as const;

// Made with Bob
