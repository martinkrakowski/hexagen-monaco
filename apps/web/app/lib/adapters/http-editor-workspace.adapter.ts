import { fetchWithCsrf } from "../csrf-fetch";
import { getActiveTenantId } from "../active-tenant";
import type {
  EditorWorkspacePersistencePort,
  LoggerPort,
  PersistenceError,
  PersistedEditorWorkspace,
  Result,
} from "@hexagen/shared";
import type {
  ConflictEntry,
  ConflictRecord,
  ConflictWhere,
  LiftStamp,
} from "./idb-editor-workspace.adapter";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The IDB adapter implements the port plus the stamp primitives; this
 * structural type lets the cached adapter depend on the interface, not the
 * concrete class.
 */
export interface EditorWorkspaceCachePort extends EditorWorkspacePersistencePort {
  getLiftStamp(sessionId: string): Promise<LiftStamp | null>;
  setLiftStamp(sessionId: string, stamp: LiftStamp | null): Promise<void>;
  recordConflict(entry: ConflictEntry): Promise<void>;
  getConflicts(): Promise<ConflictRecord | null>;
}

/**
 * Default userIdSource: fetches `GET /api/auth/session` once, reads `user.sub`,
 * caches a non-null answer in memory, returns null on any failure or when there
 * is no user. `null` means signed out or offline — every method goes straight
 * to the cache.
 */
let cachedUserId: string | undefined;

export async function defaultUserIdSource(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  try {
    const response = await fetch("/api/auth/session");
    if (!response.ok) return null;
    const data = (await response.json()) as { user?: { sub?: unknown } };
    const sub = data?.user?.sub;
    if (typeof sub === "string" && sub.length > 0) {
      cachedUserId = sub;
      return sub;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Item 15: resets the cached user id so the next call to
 * `defaultUserIdSource` re-fetches `/api/auth/session`. Called when a remote
 * response is 401/403 — a tab whose session ended must stop addressing the
 * old account's URL.
 */
export function resetCachedUserId(): void {
  cachedUserId = undefined;
}

/** Client copy of the server's id pattern (pinned by test to avoid drift). */
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
/** Client copy of the server's payload cap (UTF-16 code units). */
export const MAX_PAYLOAD_LENGTH = 2_000_000;

/**
 * Strip the RFC 7232 wrapper / weakness flag so an `ETag: "rev:<n>"` (or
 * `W/"rev:<n>"`) header becomes the bare integer rev. Returns null when the
 * header is absent or not in the expected form.
 */
function revFromEtag(etag: string | null): number | null {
  if (!etag) return null;
  const trimmed = etag.trim().replace(/^W\//, "").replaceAll('"', "");
  const match = /^rev:(\d+)$/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export interface ReadOk {
  ok: true;
  workspace: unknown;
  rev: number;
  updatedAt: number;
}

export type ReadResult =
  | ReadOk
  | {
      ok: false;
      reason: "not_found" | "unauthenticated" | "rate_limited" | "error";
      status?: number;
      message: string;
    };

export interface WriteOk {
  ok: true;
  rev: number;
}

export type WriteResult =
  | WriteOk
  | {
      ok: false;
      reason: "conflict";
      serverRev?: number;
      message: string;
    }
  | { ok: false; reason: "too_large"; bodyLength: number; message: string }
  | {
      ok: false;
      reason: "not_found" | "unauthenticated" | "rate_limited" | "error";
      status?: number;
      message: string;
    };

export type DeleteResult =
  | { ok: true; deleted: boolean }
  | { ok: false; reason: "conflict"; serverRev?: number; message: string }
  | {
      ok: false;
      reason: "unauthenticated" | "rate_limited" | "error";
      status?: number;
      message: string;
    };

export class HttpEditorWorkspaceAdapter {
  constructor(private readonly fetchImpl: typeof fetch = fetchWithCsrf) {}

  private documentUrlFor(ownerId: string, id: string): string {
    return `/api/tenants/${encodeURIComponent(ownerId)}/documents/workspace/${encodeURIComponent(id)}`;
  }

  /**
   * GET the remote workspace document. Returns the workspace payload and the
   * rev from the ETag. A 200 without a parseable ETag is an error. The rev
   * is NOT stored internally — callers pass it explicitly to `write`.
   */
  async read(ownerId: string, id: string): Promise<ReadResult> {
    try {
      const response = await this.fetchImpl(this.documentUrlFor(ownerId, id), {
        headers: { "Content-Type": "application/json" },
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          reason: "unauthenticated",
          message: "Sign in required",
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          reason: "not_found",
          message: "Document not found",
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          reason: "rate_limited",
          message: "Rate limited",
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: "error",
          status: response.status,
          message: `Request failed (${response.status})`,
        };
      }
      const body = (await response.json()) as {
        payload: unknown;
        updatedAt: number;
      };
      const etag = response.headers.get("ETag");
      const rev = revFromEtag(etag);
      if (rev === null) {
        return {
          ok: false,
          reason: "error",
          status: response.status,
          message: "missing ETag",
        } as ReadResult;
      }
      return {
        ok: true,
        workspace: body.payload,
        rev,
        updatedAt: body.updatedAt,
      };
    } catch (cause) {
      return {
        ok: false,
        reason: "error",
        status: 0,
        message: `Request failed: ${String(cause)}`,
      };
    }
  }

  /**
   * PUT the workspace payload. The body always carries `projectId`. An
   * `If-Match: rev:<n>` header is sent only when the caller passes a
   * non-null `ifMatch`; a 409 is returned as a conflict without retry.
   */
  async write(
    ownerId: string,
    id: string,
    payload: unknown,
    projectId: string,
    precondition: { ifMatch: number } | { createOnly: true },
  ): Promise<WriteResult> {
    const body = JSON.stringify({ payload, projectId });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if ("createOnly" in precondition) {
      headers["If-None-Match"] = "*";
    } else {
      headers["If-Match"] = `"rev:${precondition.ifMatch}"`;
    }
    try {
      const response = await this.fetchImpl(this.documentUrlFor(ownerId, id), {
        method: "PUT",
        headers,
        body,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          reason: "unauthenticated",
          message: "Sign in required",
        };
      }
      if (response.status === 404 || response.status === 400) {
        return {
          ok: false,
          reason: "not_found",
          message: `Request failed (${response.status})`,
          status: response.status,
        };
      }
      if (response.status === 409 || response.status === 412) {
        return {
          ok: false,
          reason: "conflict",
          serverRev: revFromEtag(response.headers.get("ETag")) ?? undefined,
          message: "Document was updated elsewhere",
        };
      }
      if (response.status === 413) {
        return {
          ok: false,
          reason: "too_large",
          bodyLength: body.length,
          message: `Payload exceeds ${MAX_PAYLOAD_LENGTH} characters`,
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          reason: "rate_limited",
          message: "Rate limited",
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: "error",
          status: response.status,
          message: `Request failed (${response.status})`,
        };
      }
      const newRev = revFromEtag(response.headers.get("ETag"));
      return { ok: true, rev: newRev ?? 0 };
    } catch (cause) {
      return {
        ok: false,
        reason: "error",
        status: 0,
        message: `Request failed: ${String(cause)}`,
      };
    }
  }

  /**
   * DELETE the server-side document, conditional on `ifMatch`. The route
   * requires `If-Match: "rev:<n>"`; a stale rev is 412, and 404 means the
   * document is already gone (treat as done).
   */
  async delete(
    ownerId: string,
    id: string,
    ifMatch: number,
  ): Promise<DeleteResult> {
    try {
      const response = await this.fetchImpl(this.documentUrlFor(ownerId, id), {
        method: "DELETE",
        headers: { "If-Match": `"rev:${ifMatch}"` },
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          reason: "unauthenticated",
          message: "Sign in required",
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          reason: "rate_limited",
          message: "Rate limited",
        };
      }
      if (response.status === 404) {
        return { ok: true, deleted: false };
      }
      if (response.status === 412) {
        return {
          ok: false,
          reason: "conflict",
          serverRev: revFromEtag(response.headers.get("ETag")) ?? undefined,
          message: "Document was updated elsewhere",
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: "error",
          status: response.status,
          message: `Request failed (${response.status})`,
        };
      }
      return { ok: true, deleted: response.status === 204 };
    } catch (cause) {
      return {
        ok: false,
        reason: "error",
        status: 0,
        message: `Request failed: ${String(cause)}`,
      };
    }
  }
}

/** Milliseconds of quiet the adapter waits after the last save before writing. */
const REMOTE_DEBOUNCE_MS = 1500;

export class CachedEditorWorkspaceAdapter implements EditorWorkspacePersistencePort {
  /** ids for which a 409 conflict was seen; no remote writes until next load. */
  private readonly pausedIds = new Set<string>();
  /** Per-sessionId debounce timer for the trailing server write. */
  private readonly writeTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Per-id epoch; clearWorkspace bumps it to cancel in-flight writes. */
  private readonly epochs = new Map<string, number>();
  /** Per-id in-flight remote write, so two PUTs can't self-conflict. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly cache: EditorWorkspaceCachePort,
    private readonly remote: HttpEditorWorkspaceAdapter,
    private readonly tenantIdSource: () => string | null = getActiveTenantId,
    private readonly userIdSource: () => Promise<
      string | null
    > = defaultUserIdSource,
    private readonly logger: LoggerPort,
  ) {}

  async loadWorkspace(
    sessionId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    if (this.tenantIdSource() !== null) {
      return this.cache.loadWorkspace(sessionId);
    }
    const userId = await this.userIdSource();
    if (userId === null) {
      return this.cache.loadWorkspace(sessionId);
    }
    if (!DOCUMENT_ID_PATTERN.test(sessionId)) {
      this.logger.warn(`workspace ${sessionId} skipped: id failed pattern`);
      return this.cache.loadWorkspace(sessionId);
    }
    if (!UUID_PATTERN.test(sessionId)) {
      this.logger.warn(`workspace ${sessionId} skipped: id is not a UUID`);
      return this.cache.loadWorkspace(sessionId);
    }
    return this.loadFromRemote(sessionId, userId);
  }

  private cancelWriteTimer(sessionId: string): void {
    const existing = this.writeTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.writeTimers.delete(sessionId);
    }
  }

  private async cacheStaleSince(
    sessionId: string,
    firstRead: Result<PersistedEditorWorkspace | null, PersistenceError>,
  ): Promise<boolean> {
    const recheck = await this.cache.loadWorkspace(sessionId);
    if (!recheck.success) return true;
    if (!firstRead.success || firstRead.value === null) {
      return recheck.value !== null;
    }
    return (
      recheck.value === null ||
      recheck.value.updatedAt !== firstRead.value!.updatedAt
    );
  }

  private async loadFromRemote(
    sessionId: string,
    userId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    this.pausedIds.delete(sessionId);

    const cacheResult = await this.cache.loadWorkspace(sessionId);
    if (!cacheResult.success) return cacheResult;

    const readResult = await this.remote.read(userId, sessionId);

    if (!readResult.ok) {
      if (readResult.reason === "not_found") {
        if (cacheResult.value !== null) {
          return this.maybeLift(sessionId, userId, cacheResult);
        }
        this.firstWriteAfter404.add(sessionId);
        return cacheResult;
      }
      if (readResult.reason === "unauthenticated") {
        resetCachedUserId();
      }
      return cacheResult;
    }

    const serverWs = readResult.workspace as PersistedEditorWorkspace;
    const stamp = await this.cache.getLiftStamp(sessionId);

    if (stamp !== null && stamp.ownerId !== userId) {
      return cacheResult;
    }

    const hasCache = cacheResult.value !== null;

    if (!hasCache) {
      if (await this.cacheStaleSince(sessionId, cacheResult)) {
        return this.cache.loadWorkspace(sessionId);
      }
      await this.cache.saveWorkspace(sessionId, serverWs);
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: readResult.rev,
        syncedUpdatedAt: serverWs.updatedAt,
        confirmed: true,
      });
      return { success: true, value: serverWs };
    }

    const cacheEntry = cacheResult.value!;
    const hasStamp = stamp !== null;

    if (!hasStamp) {
      if (JSON.stringify(cacheEntry) === JSON.stringify(serverWs)) {
        await this.tryStamp(sessionId, {
          ownerId: userId,
          rev: readResult.rev,
          syncedUpdatedAt: cacheEntry.updatedAt,
          confirmed: true,
        });
        return cacheResult;
      }
      this.cancelWriteTimer(sessionId);
      await this.recordConflictEntry(sessionId, "load", null, readResult.rev);
      this.logger.warn(
        `workspace ${sessionId} conflict: no stamp, cache differs from server`,
      );
      this.pausedIds.add(sessionId);
      return cacheResult;
    }

    const dirty = cacheEntry.updatedAt !== stamp.syncedUpdatedAt;
    const moved = readResult.rev !== stamp.rev;

    if (!dirty && !moved) {
      if (
        readResult.rev === stamp.rev &&
        JSON.stringify(serverWs) === JSON.stringify(cacheEntry)
      ) {
        await this.tryStamp(sessionId, { ...stamp, confirmed: true });
      }
      return cacheResult;
    }
    if (!dirty && moved) {
      if (await this.cacheStaleSince(sessionId, cacheResult)) {
        return this.cache.loadWorkspace(sessionId);
      }
      await this.cache.saveWorkspace(sessionId, serverWs);
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: readResult.rev,
        syncedUpdatedAt: serverWs.updatedAt,
        confirmed: true,
      });
      return { success: true, value: serverWs };
    }
    if (dirty && !moved) {
      return this.catchUp(sessionId, userId, cacheEntry, stamp);
    }
    this.cancelWriteTimer(sessionId);
    await this.recordConflictEntry(
      sessionId,
      "load",
      stamp.rev,
      readResult.rev,
    );
    this.logger.warn(
      `workspace ${sessionId} conflict: cache dirty and server moved (cache rev=${stamp.rev}, server rev=${readResult.rev})`,
    );
    this.pausedIds.add(sessionId);
    return cacheResult;
  }

  private async tryStamp(sessionId: string, stamp: LiftStamp): Promise<void> {
    try {
      await this.cache.setLiftStamp(sessionId, stamp);
    } catch {
      // stamp writes are best-effort
    }
  }

  private async recordConflictEntry(
    sessionId: string,
    where: ConflictWhere,
    stampRev: number | null,
    serverRev: number | null,
  ): Promise<void> {
    try {
      await this.cache.recordConflict({
        id: sessionId,
        at: new Date().toISOString(),
        where,
        stampRev,
        serverRev,
      });
    } catch {
      // best-effort: never fail the editor
    }
  }

  /** 404 path: lift the cache onto the server via an unconditional PUT. */
  private async maybeLift(
    sessionId: string,
    userId: string,
    cacheResult: Result<PersistedEditorWorkspace | null, PersistenceError>,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    if (!cacheResult.success || cacheResult.value === null) {
      return cacheResult;
    }
    const cacheEntry = cacheResult.value;
    const stamp = await this.cache.getLiftStamp(sessionId);
    // Foreign stamp: do not lift.
    if (stamp !== null && stamp.ownerId !== userId) {
      return cacheResult;
    }

    // LIFT: create-only PUT with the cache value.
    const putResult = await this.remote.write(
      userId,
      sessionId,
      cacheEntry,
      sessionId,
      { createOnly: true },
    );
    if (!putResult.ok) {
      if (putResult.reason === "conflict") {
        this.logger.warn(
          `workspace ${sessionId} conflict: created elsewhere before the lift`,
        );
        await this.recordConflictEntry(
          sessionId,
          "lift",
          null,
          putResult.serverRev ?? null,
        );
      } else {
        this.logger.warn(
          `workspace ${sessionId} lift PUT failed: ${putResult.message}`,
        );
      }
      this.pausedIds.add(sessionId);
      return cacheResult;
    }
    const putRev = putResult.rev;
    // Item 10: stamp unconfirmed after PUT.
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putRev,
      syncedUpdatedAt: cacheEntry.updatedAt,
      confirmed: false,
    });

    // Confirming GET — must match rev and payload.
    const confirmResult = await this.remote.read(userId, sessionId);
    if (!confirmResult.ok) {
      this.logger.warn(
        `workspace ${sessionId} lift confirm failed: ${confirmResult.message}`,
      );
      return cacheResult;
    }
    if (confirmResult.rev !== putRev) {
      this.logger.warn(
        `workspace ${sessionId} lift rev mismatch: put=${putRev}, got=${confirmResult.rev}`,
      );
      return cacheResult;
    }
    if (
      JSON.stringify(confirmResult.workspace) !== JSON.stringify(cacheEntry)
    ) {
      this.logger.warn(`workspace ${sessionId} lift payload mismatch`);
      return cacheResult;
    }

    // Lifted and confirmed: stamp with confirmed: true.
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putRev,
      syncedUpdatedAt: cacheEntry.updatedAt,
      confirmed: true,
    });
    return cacheResult;
  }

  /** dirty | not moved → catch up with one PUT + confirming GET + stamp. */
  private async catchUp(
    sessionId: string,
    userId: string,
    cacheEntry: PersistedEditorWorkspace,
    stamp: LiftStamp,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    const putResult = await this.remote.write(
      userId,
      sessionId,
      cacheEntry,
      sessionId,
      { ifMatch: stamp.rev },
    );
    if (!putResult.ok) {
      this.logger.warn(
        `workspace ${sessionId} catch-up PUT failed: ${putResult.message}`,
      );
      return { success: true, value: cacheEntry };
    }
    const confirmResult = await this.remote.read(userId, sessionId);
    if (!confirmResult.ok) {
      this.logger.warn(`workspace ${sessionId} catch-up confirm failed`);
      return { success: true, value: cacheEntry };
    }
    if (confirmResult.rev !== putResult.rev) {
      this.logger.warn(`workspace ${sessionId} catch-up rev mismatch`);
      return { success: true, value: cacheEntry };
    }
    if (
      JSON.stringify(confirmResult.workspace) !== JSON.stringify(cacheEntry)
    ) {
      this.logger.warn(`workspace ${sessionId} catch-up payload mismatch`);
      return { success: true, value: cacheEntry };
    }
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putResult.rev,
      syncedUpdatedAt: cacheEntry.updatedAt,
      confirmed: true,
    });
    return { success: true, value: cacheEntry };
  }

  async saveWorkspace(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
  ): Promise<Result<void, PersistenceError>> {
    const cacheResult = await this.cache.saveWorkspace(sessionId, workspace);
    if (!cacheResult.success) return cacheResult;

    if (this.tenantIdSource() !== null) return cacheResult;

    const userId = await this.userIdSource();
    if (userId === null) return cacheResult;

    if (!DOCUMENT_ID_PATTERN.test(sessionId)) {
      this.logger.warn(
        `workspace ${sessionId} not saved to the server: id failed pattern`,
      );
      return cacheResult;
    }
    if (!UUID_PATTERN.test(sessionId)) {
      this.logger.warn(
        `workspace ${sessionId} not saved to the server: id is not a UUID`,
      );
      return cacheResult;
    }

    const payloadStr = JSON.stringify(workspace);
    if (payloadStr.length > MAX_PAYLOAD_LENGTH) {
      this.logger.warn(
        `workspace ${sessionId} not saved to the server: payload ${payloadStr.length} characters, limit ${MAX_PAYLOAD_LENGTH}`,
      );
      return cacheResult;
    }

    const stamp = await this.cache.getLiftStamp(sessionId);
    if (stamp !== null && stamp.ownerId !== userId) return cacheResult;
    if (this.pausedIds.has(sessionId)) return cacheResult;
    if (stamp === null && !this.firstWriteAfter404.has(sessionId)) {
      return cacheResult;
    }

    // Item 3: capture the precondition at schedule time.
    const precondition: { ifMatch: number } | { createOnly: true } =
      stamp !== null ? { ifMatch: stamp.rev } : { createOnly: true };
    const existing = this.writeTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.writeTimers.set(
      sessionId,
      setTimeout(() => {
        void this.doRemoteWrite(sessionId, workspace, userId, precondition);
      }, REMOTE_DEBOUNCE_MS),
    );

    return cacheResult;
  }

  private readonly firstWriteAfter404 = new Set<string>();

  private async doRemoteWrite(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
    userId: string,
    precondition: { ifMatch: number } | { createOnly: true },
  ): Promise<void> {
    // Item 6: nothing if paused, org switched in, or epoch changed.
    if (this.pausedIds.has(sessionId)) return;
    if (this.tenantIdSource() !== null) return;
    const epoch = this.epochs.get(sessionId) ?? 0;
    if (epoch !== (this.epochs.get(sessionId) ?? 0)) return; // epoch captured below

    this.writeTimers.delete(sessionId);
    const epochAtStart = this.epochs.get(sessionId) ?? 0;

    const prev = this.inFlight.get(sessionId) ?? Promise.resolve();
    const current = prev.then(async () => {
      await this._doRemoteWrite(
        sessionId,
        workspace,
        userId,
        precondition,
        epochAtStart,
      );
    });
    this.inFlight.set(sessionId, current);
  }

  private async _doRemoteWrite(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
    userId: string,
    precondition: { ifMatch: number } | { createOnly: true },
    epochAtStart: number,
  ): Promise<void> {
    try {
      // Item 6: re-check paused, org, epoch after awaiting inFlight.
      if (this.pausedIds.has(sessionId)) return;
      if (this.tenantIdSource() !== null) return;
      if (epochAtStart !== (this.epochs.get(sessionId) ?? 0)) return;

      const result = await this.remote.write(
        userId,
        sessionId,
        workspace,
        sessionId,
        precondition,
      );
      if (!result.ok) {
        switch (result.reason) {
          case "conflict":
            if ("createOnly" in precondition) {
              this.logger.warn(
                `workspace ${sessionId} conflict: created elsewhere before the first save`,
              );
              await this.recordConflictEntry(
                sessionId,
                "first-save",
                null,
                result.serverRev ?? null,
              );
            } else {
              this.logger.warn(
                `workspace ${sessionId} save conflict: one PUT, server rev=${result.serverRev ?? "unknown"}`,
              );
              await this.recordConflictEntry(
                sessionId,
                "save",
                precondition.ifMatch,
                result.serverRev ?? null,
              );
            }
            this.pausedIds.add(sessionId);
            break;
          case "too_large":
            this.logger.warn(
              `workspace ${sessionId} not saved to the server: payload ${result.bodyLength} characters, limit ${MAX_PAYLOAD_LENGTH}`,
            );
            break;
          case "unauthenticated":
            resetCachedUserId();
            this.logger.warn(`workspace ${sessionId} save unauthenticated`);
            break;
          default:
            this.logger.warn(
              `workspace ${sessionId} save failed: ${result.message}`,
            );
            break;
        }
        return;
      }

      this.firstWriteAfter404.delete(sessionId);
      const prevStamp = await this.cache.getLiftStamp(sessionId);
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: result.rev,
        syncedUpdatedAt: workspace.updatedAt,
        confirmed: prevStamp?.confirmed ?? false,
      });

      // Item 12: if the epoch changed during this write, delete the copy
      // (a clear happened while the PUT was in flight).
      if (epochAtStart !== (this.epochs.get(sessionId) ?? 0)) {
        await this.remote.delete(userId, sessionId, result.rev);
      }
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  async clearWorkspace(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    // Item 12: increment epoch before anything else.
    this.epochs.set(sessionId, (this.epochs.get(sessionId) ?? 0) + 1);
    // Item 13: await any in-flight write for this id.
    const inFlight = this.inFlight.get(sessionId);
    if (inFlight) await inFlight.catch(() => {});

    this.cancelWriteTimer(sessionId);
    this.firstWriteAfter404.delete(sessionId);

    // AM1: org tenant → cache only.
    if (this.tenantIdSource() !== null) {
      return this.cache.clearWorkspace(sessionId);
    }

    // Check paused BEFORE removing from pausedIds.
    const wasPaused = this.pausedIds.has(sessionId);
    this.pausedIds.delete(sessionId);

    const userId = await this.userIdSource();
    if (userId === null) {
      return this.cache.clearWorkspace(sessionId);
    }

    // Read stamp BEFORE cache clear (server DELETE needs it).
    const stamp = await this.cache.getLiftStamp(sessionId);
    const canDelete = stamp !== null && stamp.ownerId === userId && !wasPaused;

    // Cache clear + stamp removal FIRST.
    const cacheResult = await this.cache.clearWorkspace(sessionId);
    if (!canDelete) return cacheResult;

    // ONE conditional DELETE with the stamp's revision.
    const deleteResult = await this.remote.delete(
      userId,
      sessionId,
      stamp!.rev,
    );
    if (!deleteResult.ok) {
      if (deleteResult.reason === "conflict") {
        this.logger.warn(
          `workspace ${sessionId}: server copy changed on another device, not deleted`,
        );
        await this.recordConflictEntry(
          sessionId,
          "discard",
          stamp!.rev,
          deleteResult.serverRev ?? null,
        );
      } else {
        this.logger.warn(
          `workspace ${sessionId} server delete failed: ${deleteResult.message}`,
        );
      }
    }
    return cacheResult;
  }
}
