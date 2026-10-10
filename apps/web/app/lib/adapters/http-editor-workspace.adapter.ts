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
 * caches the result in memory (a non-null id, or a 30 s null cache for a signed-
 * out / offline / failed session), and returns null otherwise.
 *
 * Concurrent callers share a single in-flight fetch; a signed-out answer is
 * cached for 30 s so an offline browser does not hammer `/api/auth/session` on
 * every save.
 */
let cachedUserId: string | undefined;
let nullUntil: number = 0;
let inFlight: Promise<string | null> | null = null;

export async function defaultUserIdSource(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  const now = Date.now();
  if (now < nullUntil) return null;
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch("/api/auth/session");
      if (!response.ok) {
        nullUntil = Date.now() + 30_000;
        return null;
      }
      const data = (await response.json()) as { user?: { sub?: unknown } };
      const sub = data?.user?.sub;
      if (typeof sub === "string" && sub.length > 0) {
        cachedUserId = sub;
        return sub;
      }
      nullUntil = Date.now() + 30_000;
      return null;
    } catch {
      nullUntil = Date.now() + 30_000;
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Item 15: resets the cached user id so the next call to
 * `defaultUserIdSource` re-fetches `/api/auth/session`. Called when a remote
 * response is 401/403 — a tab whose session ended must stop addressing the
 * old account's URL. Clears all three caches: the id, the null-cache timer,
 * and the in-flight promise.
 */
export function resetCachedUserId(): void {
  cachedUserId = undefined;
  nullUntil = 0;
  inFlight = null;
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
      if (newRev === null) {
        return {
          ok: false,
          reason: "error",
          status: response.status,
          message: "missing ETag",
        };
      }
      return { ok: true, rev: newRev };
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
  /** ids for which a clearWorkspace is waiting on an in-flight write. */
  private readonly discarding = new Set<string>();
  /**
   * The precondition this tab armed for the pending or in-flight write. When a
   * write succeeds, a still-pending write that holds the SAME precondition is
   * rebased to { ifMatch: result.rev } so the next PUT carries the rev the
   * first one established (Item 1).
   */
  private readonly pendingPreconditions = new Map<
    string,
    { ifMatch: number } | { createOnly: true }
  >();

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
    this.pendingPreconditions.delete(sessionId);
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

    // Item 3: wait for any in-flight save PUT so the load's catch-up/maybeLift
    // PUT does not race it on the server.
    const inFlight = this.inFlight.get(sessionId);
    if (inFlight) await inFlight.catch(() => {});

    const cacheResult = await this.cache.loadWorkspace(sessionId);
    if (!cacheResult.success) return cacheResult;

    const readResult = await this.remote.read(userId, sessionId);

    // Item 4: check discard marker before the normal load logic.
    const stamp = await this.cache.getLiftStamp(sessionId);
    if (stamp !== null && stamp.ownerId === userId && stamp.discarded) {
      return this.handleDiscardMarker(
        sessionId,
        userId,
        stamp,
        readResult,
        cacheResult,
      );
    }

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
      // Item 8: unconfirmed stamp + moved server → treat as conflict.
      if (!stamp.confirmed) {
        this.cancelWriteTimer(sessionId);
        await this.recordConflictEntry(
          sessionId,
          "load",
          stamp.rev,
          readResult.rev,
        );
        this.logger.warn(
          `workspace ${sessionId} conflict: unconfirmed stamp, server moved (cache rev=${stamp.rev}, server rev=${readResult.rev})`,
        );
        this.pausedIds.add(sessionId);
        return cacheResult;
      }
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

  /** Item 4: handle a discard marker at the start of a load. */
  private async handleDiscardMarker(
    sessionId: string,
    userId: string,
    marker: LiftStamp,
    readResult: ReadResult,
    cacheResult: Result<PersistedEditorWorkspace | null, PersistenceError>,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    if (!readResult.ok) {
      if (readResult.reason === "not_found") {
        // GET 404 → the discarded copy is already gone: drop the marker.
        await this.cache.setLiftStamp(sessionId, null);
        if (cacheResult.success && cacheResult.value !== null) {
          return this.maybeLift(sessionId, userId, cacheResult);
        }
        // No server copy and nothing local: as after any empty load, the
        // first save creates the server copy.
        this.firstWriteAfter404.add(sessionId);
        return { success: true, value: null };
      }
      // GET failed (offline/error) → keep marker; honor any cache entry.
      if (readResult.reason === "unauthenticated") resetCachedUserId();
      return cacheResult.success && cacheResult.value !== null
        ? cacheResult
        : { success: true, value: null };
    }
    if (readResult.rev === marker.rev) {
      // Server copy still at the discarded rev → retry DELETE.
      const delResult = await this.remote.delete(userId, sessionId, marker.rev);
      if (delResult.ok) {
        // 204 → dropped; the server copy is gone now.
        await this.cache.setLiftStamp(sessionId, null);
        if (cacheResult.success && cacheResult.value !== null) {
          return this.maybeLift(sessionId, userId, cacheResult);
        }
        // No server copy and nothing local: as after any empty load, the
        // first save creates the server copy.
        this.firstWriteAfter404.add(sessionId);
        return { success: true, value: null };
      }
      // DELETE failed → keep marker; honor any cache entry.
      return cacheResult.success && cacheResult.value !== null
        ? cacheResult
        : { success: true, value: null };
    }
    // GET 200 with different rev → moved on another device.
    this.logger.warn(
      `workspace ${sessionId}: changed on another device after it was discarded here`,
    );
    await this.cache.setLiftStamp(sessionId, null); // drop marker
    // Hand over to the existing normal load logic with the marker gone.
    return this.loadFromRemote(sessionId, userId);
  }

  private async tryStamp(sessionId: string, stamp: LiftStamp): Promise<void> {
    try {
      await this.cache.setLiftStamp(sessionId, stamp);
    } catch {
      // stamp writes are best-effort
    }
  }

  /** Item 1: compare two preconditions for equality. */
  private preconditionMatches(
    a: { ifMatch: number } | { createOnly: true },
    b: { ifMatch: number } | { createOnly: true },
  ): boolean {
    if ("createOnly" in a) return "createOnly" in b;
    if ("createOnly" in b) return false;
    return a.ifMatch === b.ifMatch;
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
    // Item 9: own stamp + clean cache → deleted elsewhere, keep browser copy.
    if (stamp !== null && stamp.ownerId === userId && stamp.confirmed) {
      if (cacheEntry.updatedAt === stamp.syncedUpdatedAt) {
        this.logger.warn(
          `workspace ${sessionId}: deleted on another device; kept in this browser, not uploaded again`,
        );
        await this.recordConflictEntry(
          sessionId,
          "deleted-elsewhere",
          stamp.rev,
          null,
        );
        this.pausedIds.add(sessionId);
        return cacheResult;
      }
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

    // Item 3: rebase any pending save timer on the new rev so its PUT
    // carries the fresh rev, not the stale one.
    if (this.pendingPreconditions.has(sessionId)) {
      this.pendingPreconditions.set(sessionId, { ifMatch: putRev });
    }

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
      // Item 7(a): a 409/412 from catchUp's PUT is a conflict like the others.
      this.logger.warn(
        `workspace ${sessionId} catch-up PUT failed: ${putResult.message}`,
      );
      await this.recordConflictEntry(
        sessionId,
        "load",
        stamp.rev,
        putResult.reason === "conflict" ? (putResult.serverRev ?? null) : null,
      );
      this.pausedIds.add(sessionId);
      this.cancelWriteTimer(sessionId);
      return { success: true, value: cacheEntry };
    }
    // Item 7(b): stamp unconfirmed after PUT, before confirming GET.
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putResult.rev,
      syncedUpdatedAt: cacheEntry.updatedAt,
      confirmed: false,
    });

    // Item 3: rebase any pending save timer on the new rev so its PUT
    // carries the fresh rev, not the stale one.
    if (this.pendingPreconditions.has(sessionId)) {
      this.pendingPreconditions.set(sessionId, { ifMatch: putResult.rev });
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
    // Item 4: a discard marker is kept as-is; never schedule or send on it.
    if (stamp !== null && stamp.ownerId === userId && stamp.discarded) {
      return cacheResult;
    }
    const effectiveStamp = stamp;
    if (effectiveStamp === null && !this.firstWriteAfter404.has(sessionId)) {
      return cacheResult;
    }
    // Item 3: capture the precondition at schedule time.
    const precondition: { ifMatch: number } | { createOnly: true } =
      effectiveStamp !== null
        ? { ifMatch: effectiveStamp.rev }
        : { createOnly: true };
    // Item 1: a save made while a discard is waiting must not arm a timer or
    // set a precondition, lest it survive the discard.
    if (this.discarding.has(sessionId)) return cacheResult;
    this.pendingPreconditions.set(sessionId, precondition);
    const existing = this.writeTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.writeTimers.set(
      sessionId,
      setTimeout(() => {
        const pending = this.pendingPreconditions.get(sessionId);
        if (pending) {
          void this.doRemoteWrite(sessionId, workspace, userId, pending);
        }
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
    // Item 1: a write armed while a discard is waiting must not proceed.
    if (this.discarding.has(sessionId)) return;
    const epochNow = this.epochs.get(sessionId) ?? 0;
    this.writeTimers.delete(sessionId);
    const epochAtStart = epochNow;

    const prev = this.inFlight.get(sessionId) ?? Promise.resolve();
    // Item 2: keep a reference to THIS write's in-flight promise so the
    // finally block only clears an entry it still owns. A later, chained
    // write replaces the map entry; we must not delete that one, else a
    // discard during the chained write would not wait for it.
    const current: Promise<void> = prev
      .catch(() => {})
      .then(async () => {
        await this._doRemoteWrite(
          sessionId,
          workspace,
          userId,
          precondition,
          epochAtStart,
          current,
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
    inFlightPromise: Promise<void>,
  ): Promise<void> {
    try {
      // Item 6: re-check paused, org, epoch after awaiting inFlight.
      if (this.pausedIds.has(sessionId)) return;
      if (this.tenantIdSource() !== null) return;
      // Item 1: re-check the discard window after awaiting inFlight.
      if (this.discarding.has(sessionId)) return;
      if (epochAtStart !== (this.epochs.get(sessionId) ?? 0)) return;

      // Item 2: re-read the stamp right before stamping — the timer captured
      // the precondition by value, but a prior write in the same chain may
      // have stamped a new rev. Rebase the precondition on the fresh rev so
      // the PUT goes out with the current If-Match.
      let freshStamp: LiftStamp | null;
      try {
        freshStamp = await this.cache.getLiftStamp(sessionId);
      } catch {
        this.logger.warn(
          `workspace ${sessionId} save skipped: the stamp could not be read`,
        );
        return;
      }
      if (
        freshStamp !== null &&
        freshStamp.ownerId === userId &&
        !freshStamp.discarded
      ) {
        precondition = { ifMatch: freshStamp.rev };
      }

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

      // Item 3/6: if a discard bumped the epoch, delete the copy but don't
      // write a stamp (the discard cleared the cache+stamp already).
      if (epochAtStart !== (this.epochs.get(sessionId) ?? 0)) {
        const deleteResult = await this.remote.delete(
          userId,
          sessionId,
          result.rev,
        );
        if (!deleteResult.ok) {
          if (deleteResult.reason === "conflict") {
            this.logger.warn(
              `workspace ${sessionId}: server copy changed on another device, not deleted`,
            );
            await this.recordConflictEntry(
              sessionId,
              "discard",
              result.rev,
              deleteResult.serverRev ?? null,
            );
          } else {
            // Item 3: clean-up DELETE lost (network/429/5xx) → keep a marker
            // so the next load retries the deletion and the discarded
            // workspace does not come back.
            this.logger.warn(
              `workspace ${sessionId}: discard clean-up delete failed: ${deleteResult.message}; keeping marker`,
            );
            await this.tryStamp(sessionId, {
              ownerId: userId,
              rev: result.rev,
              syncedUpdatedAt: 0,
              confirmed: false,
              discarded: true,
            });
          }
        }
        this.pendingPreconditions.delete(sessionId);
        return;
      }

      const prevStamp = await this.cache
        .getLiftStamp(sessionId)
        .catch(() => null);
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: result.rev,
        syncedUpdatedAt: workspace.updatedAt,
        confirmed: prevStamp?.confirmed ?? false,
      });

      // Item 1: rebase any pending write that still holds the precondition
      // this PUT used, so the next send carries the rev just confirmed.
      const pending = this.pendingPreconditions.get(sessionId);
      if (pending && this.preconditionMatches(pending, precondition)) {
        this.pendingPreconditions.set(sessionId, { ifMatch: result.rev });
      }
    } finally {
      // Item 2: only clear the entry if a later, chained write hasn't
      // already replaced it; otherwise that write's in-flight promise would
      // be removed by this write's finally, and a discard during it would
      // not wait for it (and it could stamp after the discard).
      if (this.inFlight.get(sessionId) === inFlightPromise) {
        this.inFlight.delete(sessionId);
      }
    }
  }

  async clearWorkspace(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    this.discarding.add(sessionId);
    try {
      // Item 12: increment epoch before anything else.
      this.epochs.set(sessionId, (this.epochs.get(sessionId) ?? 0) + 1);
      // Item 6: cancel the timer BEFORE awaiting the in-flight write so a
      // deferred timer cannot fire during the wait and re-create the document.
      this.cancelWriteTimer(sessionId);
      this.firstWriteAfter404.delete(sessionId);
      // Wait for every in-flight write, including any chained behind it, so a
      // save armed during the wait cannot land before the DELETE. Re-check the
      // map: a chained write replaces the entry, and _doRemoteWrite's finally
      // clears it only if it still owns it, so this does not spin on a settled
      // promise still lingering in the map.
      for (
        let p = this.inFlight.get(sessionId);
        p;
        p = this.inFlight.get(sessionId)
      ) {
        await p.catch(() => {});
        if (this.inFlight.get(sessionId) === p) this.inFlight.delete(sessionId);
      }

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
      const canDelete =
        stamp !== null && stamp.ownerId === userId && !wasPaused;
      const ownStampRev =
        stamp !== null && stamp.ownerId === userId ? stamp.rev : null;

      // Cache clear + stamp removal FIRST.
      const cacheResult = await this.cache.clearWorkspace(sessionId);
      this.cancelWriteTimer(sessionId);
      if (!canDelete) {
        // Item 4: write a discard marker instead of the stamp.
        if (ownStampRev !== null) {
          await this.tryStamp(sessionId, {
            ownerId: userId,
            rev: ownStampRev,
            syncedUpdatedAt: 0,
            confirmed: false,
            discarded: true,
          });
        }
        return cacheResult;
      }

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
          // Item 4: skipped/failed DELETE (not 412) → keep a marker.
          this.logger.warn(
            `workspace ${sessionId}: server delete failed: ${deleteResult.message}; keeping marker`,
          );
          await this.tryStamp(sessionId, {
            ownerId: userId,
            rev: stamp!.rev,
            syncedUpdatedAt: 0,
            confirmed: false,
            discarded: true,
          });
        }
      }
      return cacheResult;
    } finally {
      this.discarding.delete(sessionId);
    }
  }
}
