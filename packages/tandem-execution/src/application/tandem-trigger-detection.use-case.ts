import type { LocalModelState } from "../domain/index.js";
import type { ConnectionHealthState } from "../domain/index.js";
import type { TandemConfig } from "../domain/index.js";
import type { TandemConfigPersistencePort } from "./ports/tandem-config-persistence.port.js";
import type { Result } from "@hexagen/shared";
import { ok } from "@hexagen/shared";

export type TandemActivationPath = "local-only" | "tandem" | "keep-current";

/**
 * TandemTriggerDetectionUseCase
 *
 * Detects forward and reverse trigger conditions for the Tandem Interception
 * Modal and commits the user's chosen activation path to persisted config.
 *
 * Section 4.1 — Forward Trigger:
 *   Fires when a local model transitions to DOWNLOADED while a cloud provider
 *   is in VALID or DEGRADED state.
 *
 * Section 4.2 — Reverse Trigger:
 *   Fires when a cloud provider transitions from UNVALIDATED to VALID while
 *   a local model is in ACTIVE state.
 *
 * Section 4.3 — Activation Commit:
 *   Persists the user's path selection (local-only / tandem / keep-current).
 */
export class TandemTriggerDetectionUseCase {
  /**
   * Forward trigger: local model just became DOWNLOADED and a cloud provider
   * is available (VALID or DEGRADED).
   *
   * Returns true only when:
   *   localModelState === 'DOWNLOADED'
   *   AND cloudHealthState === 'VALID' | 'DEGRADED'
   */
  checkForwardTrigger(
    localModelState: LocalModelState,
    cloudHealthState: ConnectionHealthState,
  ): boolean {
    if (localModelState !== "DOWNLOADED") return false;
    return cloudHealthState === "VALID" || cloudHealthState === "DEGRADED";
  }

  /**
   * Reverse trigger: cloud provider just transitioned from UNVALIDATED to VALID
   * while the local model is already ACTIVE.
   *
   * Returns true only when:
   *   localModelState === 'ACTIVE'
   *   AND previousCloudState === 'UNVALIDATED'
   *   AND currentCloudState === 'VALID'
   */
  checkReverseTrigger(
    localModelState: LocalModelState,
    previousCloudState: ConnectionHealthState,
    currentCloudState: ConnectionHealthState,
  ): boolean {
    if (localModelState !== "ACTIVE") return false;
    if (previousCloudState !== "UNVALIDATED") return false;
    return currentCloudState === "VALID";
  }

  /**
   * Commits the user's path selection from the Tandem Interception Modal.
   *
   * Path A (local-only): sets enabled: false, persists.
   * Path B (tandem):     sets enabled: true, persists.
   * Path C (keep-current): no changes, returns current config unchanged.
   */
  commitActivation(
    path: TandemActivationPath,
    config: TandemConfig,
    configPersistence: TandemConfigPersistencePort,
  ): Result<TandemConfig> {
    if (path === "keep-current") {
      return ok(config);
    }

    const updated: TandemConfig = {
      ...config,
      enabled: path === "tandem",
    };

    const writeResult = configPersistence.write(updated);
    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }

    return ok(updated);
  }
}
