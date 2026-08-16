import {
  getEventBus,
  getChatPersistence,
  getGenerationResultPersistence,
} from "@/lib/wire.client";
import { PROJECT_DISCARDED_EVENT } from "@hexagen/monaco-orchestration";
import { useGovernanceThreadStore } from "../../../features/governance-assistant/stores/useGovernanceThreadStore";
import { logger } from "../../../lib/structured-logger";

export interface DiscardProjectResult {
  success: boolean;
}

export interface DiscardProjectParams {
  projectId: string;
}

/**
 * Runs a purge, swallowing and logging a *rejection*.
 *
 * Each leg of the cascade was individually `.catch`-guarded when it lived in
 * the wire.client subscriber, so one unavailable store never stopped the
 * others — and discard never failed for the user. Preserved verbatim,
 * including the log messages.
 *
 * PRE-EXISTING, DELIBERATELY UNCHANGED: both purge ports return a
 * `Result<void, …>` rather than throwing on a handled failure, and neither
 * the old subscriber's `.catch` nor the old `try`/`catch` here inspected it —
 * a `{ success: false }` purge was, and still is, silently ignored. Widening
 * this to check the Result would be a behaviour change, not an extraction, so
 * it is left for a separate decision. Hence the `unknown` return type: the
 * Result is discarded on purpose, not by oversight.
 */
async function purgeQuietly(
  run: () => Promise<unknown>,
  failureMessage: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error(failureMessage, { error: err });
  }
}

/**
 * Discards a project: announces it, then purges everything scoped to it.
 *
 * The purge cascade used to be wired as an inline `ProjectDiscarded`
 * subscriber in the client composition root (`wire.client.ts`) — which this
 * use case's own `publish()` triggered, so a discard purged chat persistence
 * twice. ADR-0051 §Consequences (plan item 5.3(c)) moves the cascade here:
 * "purge everything belonging to a discarded project" is this use case's
 * responsibility, not a wiring side effect.
 *
 * The event is still published. Nothing else in the tree subscribes to it
 * today, but it remains the announcement other parts of the app may react to;
 * only the purge work moved.
 */
export async function discardProject(
  params: DiscardProjectParams,
): Promise<DiscardProjectResult> {
  const eventBus = getEventBus();
  eventBus.publish({
    type: PROJECT_DISCARDED_EVENT,
    payload: {
      projectId: params.projectId,
      timestamp: new Date(),
      reason: "user_initiated" as const,
    },
    timestamp: Date.now(),
    source: "useProjectLifecycle",
  });

  // In-memory store: cleared synchronously, as the subscriber did, so no
  // stale thread is observable while the IndexedDB purges are in flight.
  useGovernanceThreadStore.getState().clearAllThreads();

  // Started together, not chained: the subscriber fired both without awaiting
  // either, and sequencing them would add one IndexedDB round trip to the
  // discard path. `discardProject` does await both, so callers that reset the
  // workspace afterwards (useProjectLifecycle.handleDiscardAndNew) no longer
  // race the purge.
  await Promise.all([
    purgeQuietly(
      () => getChatPersistence().purgeProjectData(params.projectId),
      "Failed to purge chat persistence data:",
    ),
    purgeQuietly(
      () =>
        getGenerationResultPersistence().purgeProjectResults(params.projectId),
      "Failed to purge generation results:",
    ),
  ]);

  return { success: true };
}

export interface ResetToGenesisParams {
  onEnterGenesisMode: () => void;
  onClearSession: () => void;
  onClearActiveWorkspace: () => void;
  onResetForm: () => void;
  onCloseDialog: () => void;
  onSetStep: (step: number) => void;
}

export function resetToGenesis(params: ResetToGenesisParams): void {
  params.onResetForm();
  params.onSetStep(0);
  params.onEnterGenesisMode();
  params.onCloseDialog();
  params.onClearSession();
  params.onClearActiveWorkspace();
}
