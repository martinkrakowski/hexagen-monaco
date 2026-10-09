import { get, set, del } from "idb-keyval";
import type {
  EditorWorkspacePersistencePort,
  PersistenceError,
  PersistedEditorWorkspace,
  Result,
} from "@hexagen/shared";

const WORKSPACE_KEY_PREFIX = "hexagen:workspace:";
const LIFT_STAMP_KEY = "hexagen:workspace-lift";

/**
 * Per-id stamp that records the last workspace value confirmed on the server.
 * `syncedUpdatedAt` is the `updatedAt` of that confirmed value; `rev` is the
 * server ETag rev at the time; `ownerId` is the personal-tenant user that owns
 * the stamp so a foreign stamp is detectable and ignored.
 */
export interface LiftStamp {
  ownerId: string;
  rev: number;
  syncedUpdatedAt: number;
  confirmed: boolean;
}

export class IDBEditorWorkspaceAdapter implements EditorWorkspacePersistencePort {
  /**
   * In-tab write serialization for the single lift-stamp key (read-modify-
   * write on ONE IDB key): two interleaved writes would both read the same
   * pre-state and the later set() would silently drop the earlier one.
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  private enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(op, op);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async saveWorkspace(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
  ): Promise<Result<void, PersistenceError>> {
    try {
      await set(`${WORKSPACE_KEY_PREFIX}${sessionId}`, workspace);
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded",
            message: "IDB storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed",
          message: "Failed to save workspace to IDB",
          cause: e,
        },
      };
    }
  }

  async loadWorkspace(
    sessionId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    try {
      const data = await get<PersistedEditorWorkspace>(
        `${WORKSPACE_KEY_PREFIX}${sessionId}`,
      );
      if (!data) return { success: true, value: null };
      if (data.schemaVersion !== 1) return { success: true, value: null };
      return { success: true, value: data };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed",
          message: "Failed to load workspace from IDB",
          cause: e,
        },
      };
    }
  }

  async clearWorkspace(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    return this.enqueueWrite(async () => {
      try {
        await del(`${WORKSPACE_KEY_PREFIX}${sessionId}`);
        await this.mutateStamps(sessionId, null);
        return { success: true, value: undefined };
      } catch (e) {
        return {
          success: false,
          error: {
            kind: "Unknown",
            message: "Failed to clear workspace from IDB",
            cause: e,
          },
        };
      }
    });
  }

  async getLiftStamp(sessionId: string): Promise<LiftStamp | null> {
    try {
      const stamps =
        await get<Record<string, Partial<LiftStamp>>>(LIFT_STAMP_KEY);
      const entry = stamps?.[sessionId];
      if (!entry) return null;
      // Old stamps written before `confirmed` was added read as `false`.
      return {
        ownerId: entry.ownerId ?? "",
        rev: entry.rev ?? 0,
        syncedUpdatedAt: entry.syncedUpdatedAt ?? 0,
        confirmed: entry.confirmed ?? false,
      };
    } catch {
      return null;
    }
  }

  /** Best-effort read-modify-write of the shared stamp map. */
  async setLiftStamp(
    sessionId: string,
    stamp: LiftStamp | null,
  ): Promise<void> {
    await this.enqueueWrite(() => this.mutateStamps(sessionId, stamp));
  }

  private async mutateStamps(
    sessionId: string,
    stamp: LiftStamp | null,
  ): Promise<void> {
    try {
      const stamps = await get<Record<string, LiftStamp>>(LIFT_STAMP_KEY);
      const next: Record<string, LiftStamp> = stamps ? { ...stamps } : {};
      if (stamp === null) {
        delete next[sessionId];
      } else {
        next[sessionId] = stamp;
      }
      if (Object.keys(next).length === 0) {
        await del(LIFT_STAMP_KEY);
      } else {
        await set(LIFT_STAMP_KEY, next);
      }
    } catch {
      // Stamp operations are best-effort: a failed lift-stamp write must
      // never surface to the editor.
    }
  }
}
