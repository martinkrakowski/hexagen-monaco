import { fetchWithCsrf } from "../csrf-fetch";
import { getActiveTenantId } from "../active-tenant";
import type {
  EditorWorkspacePersistencePort,
  EditorWorkspaceConflictPort,
  PendingWorkspaceConflict,
  WorkspaceSyncPause,
  WorkspaceConflictBackup,
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
 * Deep, key-order-independent comparison of two JSON values, treating
 * `undefined` as JSON does: absent in objects, `null` in arrays.
 */
function samePayload(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    const orNull = (v: unknown) => (v === undefined ? null : v);
    return a.every((av, i) => samePayload(orNull(av), orNull(b[i])));
  }
  const aKeys = Object.keys(a as Record<string, unknown>).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const bKeys = Object.keys(b as Record<string, unknown>).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  if (aKeys.length !== bKeys.length) return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  return aKeys.every(
    (k) => Object.hasOwn(bObj, k) && samePayload(aObj[k], bObj[k]),
  );
}

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
  addConflictBackup(
    backup: WorkspaceConflictBackup,
  ): Promise<Result<void, PersistenceError>>;
  listConflictBackups(
    sessionId: string,
  ): Promise<Result<WorkspaceConflictBackup[], PersistenceError>>;
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

/**
 * Longest one request to the server may take, from sending it to the end
 * of reading its answer. Shorter than DISCARD_LOAD_WAIT_MS, so that a load
 * or a discard waiting for another one's request sees it end first.
 */
export const REMOTE_REQUEST_TIMEOUT_MS = 8_000;

export class HttpEditorWorkspaceAdapter {
  constructor(
    private readonly fetchImpl: typeof fetch = fetchWithCsrf,
    private readonly timeoutMs: number = REMOTE_REQUEST_TIMEOUT_MS,
  ) {}

  private documentUrlFor(ownerId: string, id: string): string {
    return `/api/tenants/${encodeURIComponent(ownerId)}/documents/workspace/${encodeURIComponent(id)}`;
  }

  /**
   * Runs one request under the time limit. The signal aborts the request
   * when the limit passes; the race also ends the wait when the request
   * ignores the signal. A late answer is dropped.
   */
  private async withTimeout<T>(
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    const request = run(controller.signal);
    // The loser of the race must not become an unhandled rejection.
    request.catch(() => {});
    try {
      return await Promise.race([request, timedOut]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * GET the remote workspace document. Returns the workspace payload and the
   * rev from the ETag. A 200 without a parseable ETag is an error. The rev
   * is NOT stored internally — callers pass it explicitly to `write`.
   */
  async read(ownerId: string, id: string): Promise<ReadResult> {
    try {
      return await this.withTimeout(async (signal) => {
        const response = await this.fetchImpl(
          this.documentUrlFor(ownerId, id),
          {
            headers: { "Content-Type": "application/json" },
            signal,
          },
        );
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
      });
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
      return await this.withTimeout(async (signal) => {
        const response = await this.fetchImpl(
          this.documentUrlFor(ownerId, id),
          {
            method: "PUT",
            headers,
            body,
            signal,
          },
        );
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
      });
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
      return await this.withTimeout(async (signal) => {
        const response = await this.fetchImpl(
          this.documentUrlFor(ownerId, id),
          {
            method: "DELETE",
            headers: { "If-Match": `"rev:${ifMatch}"` },
            signal,
          },
        );
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
      });
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

/**
 * Longest a discard waits for loads of the same id that are still running,
 * and longest a load waits for discards of the same id. The requests behind
 * them end after REMOTE_REQUEST_TIMEOUT_MS; this bound is the second line,
 * for a wait on something else.
 */
export const DISCARD_LOAD_WAIT_MS = 10_000;

/** What a resolve knows once its checks have passed. */
interface ResolveContext {
  userId: string;
  epochAtStart: number;
  pending: PendingWorkspaceConflict;
  /** The answer of a resolve that a discard overtook. */
  discarded: Result<void, PersistenceError>;
}

export class CachedEditorWorkspaceAdapter
  implements EditorWorkspacePersistencePort, EditorWorkspaceConflictPort
{
  /** ids for which a 409 conflict was seen; no remote writes until next load. */
  private readonly pausedIds = new Set<string>();
  /**
   * Pending conflicts per id, for the conflict port. In memory by design: a
   * reload re-detects the same conflict on the next load, so nothing is lost.
   */
  private readonly pendingConflicts = new Map<
    string,
    PendingWorkspaceConflict
  >();
  /** Paused ids that have no choice to offer, with the reason (in memory). */
  private readonly syncPauses = new Map<string, WorkspaceSyncPause>();
  /** Listeners notified whenever a pending entry or a pause note is added or removed. */
  private readonly conflictListeners = new Set<() => void>();
  /** The resolve running for an id, if any: one at a time. */
  private readonly resolving = new Map<
    string,
    {
      kind: "keep" | "other";
      promise: Promise<Result<void, PersistenceError>>;
    }
  >();
  /**
   * Counts, per id, the times "use the other device's copy" began to replace
   * the browser copy. A save captures it on entry: a save that a replacement
   * overtook is refused even after the reload has lifted the other guards.
   */
  private readonly replacements = new Map<string, number>();
  /** ids whose browser copy "use the other device's copy" is replacing now. */
  private readonly replacingBrowserCopy = new Set<string>();
  /**
   * ids whose browser copy was replaced by a resolve: saves are refused until
   * the caller has started a load, so old in-memory content is not written
   * over the copy that was taken.
   */
  private readonly reloadRequired = new Set<string>();
  /** Per-sessionId debounce timer for the trailing server write. */
  private readonly writeTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Per-id epoch; clearWorkspace bumps it to cancel in-flight writes. */
  private readonly epochs = new Map<string, number>();
  /** Per-id in-flight remote write, so two PUTs can't self-conflict. */
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Per-id in-flight loads (there can be several), so clearWorkspace can wait them out. */
  private readonly loadsInFlight = new Map<string, Set<Promise<unknown>>>();
  /** Per-id in-flight clearWorkspace calls, so a load of the same id can wait them out. */
  private readonly discardsInFlight = new Map<string, Set<Promise<unknown>>>();
  /**
   * The server revision read by a load that a discard overtook, when that load
   * was about to adopt the server copy and no stamp existed yet. The waiting
   * discard has no stamp to delete with; it deletes with this revision.
   */
  private readonly revSeenByOvertakenLoad = new Map<
    string,
    { userId: string; rev: number }
  >();
  /**
   * ids for which one or more clearWorkspace calls are in flight. A counter so
   * overlapping discards for the same id keep the document closed to saves
   * until the LAST clearWorkspace has run its cache clear.
   */
  private readonly discarding = new Map<string, number>();
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
    // A discard of this id is still running: wait for it instead of reading
    // what it is about to delete. The wait is bounded; when the discard has
    // not ended by then the answer is "none", which is what a discarded
    // workspace is. A load that waits here is NOT registered in
    // loadsInFlight, so the discard never waits for it in turn.
    // A resolve of this id is running: wait for it too, so that no load
    // clears or records the conflict under it. When it has not ended in time
    // the answer is the browser copy as it is, with no sync step.
    for (;;) {
      const resolve = this.resolving.get(sessionId);
      if (resolve !== undefined) {
        const ended = await this.settledWithin(
          [resolve.promise],
          DISCARD_LOAD_WAIT_MS,
        );
        if (!ended) return this.cache.loadWorkspace(sessionId);
        continue;
      }
      if (!this.discarding.has(sessionId)) break;
      const discards = this.discardsInFlight.get(sessionId);
      if (discards === undefined || discards.size === 0) break;
      const ended = await this.settledWithin(discards, DISCARD_LOAD_WAIT_MS);
      if (!ended) return { success: true, value: null };
    }
    // From here to the registration below there is NO await: a discard that
    // starts later finds this load registered and its epoch already captured.
    const epochAtStart = this.epochs.get(sessionId) ?? 0;
    const load = this.loadGuarded(sessionId, epochAtStart);
    let loads = this.loadsInFlight.get(sessionId);
    if (loads === undefined) {
      loads = new Set();
      this.loadsInFlight.set(sessionId, loads);
    }
    loads.add(load);
    try {
      const result = await load;
      // The caller has its answer: saves of this id are accepted again. (Not
      // earlier: a save of the old in-memory content while the load is still
      // out would be uploaded over the copy that was taken. And not after a
      // load that failed: the caller then still holds the copy that lost.)
      if (result.success) this.reloadRequired.delete(sessionId);
      return result;
    } finally {
      loads.delete(load);
      if (loads.size === 0 && this.loadsInFlight.get(sessionId) === loads) {
        this.loadsInFlight.delete(sessionId);
      }
    }
  }

  /** A load that a discard overtook answers "none", whatever it had read. */
  private async loadGuarded(
    sessionId: string,
    epochAtStart: number,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    const result = await this.loadUnguarded(sessionId, epochAtStart);
    if (this.discardedSince(sessionId, epochAtStart)) {
      return { success: true, value: null };
    }
    return result;
  }

  private async loadUnguarded(
    sessionId: string,
    epochAtStart: number,
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
    return this.loadFromRemote(sessionId, userId, epochAtStart);
  }

  /** Resolves true when every promise has settled, false when `ms` passed first. */
  private async settledWithin(
    promises: Iterable<Promise<unknown>>,
    ms: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    try {
      return await Promise.race([
        Promise.allSettled([...promises]).then(() => true),
        timedOut,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * The answer of a load that a discard overtook: nothing. `adopting` is given
   * when the load had read a server copy it was about to adopt with no stamp
   * yet. While the discard is still running, the revision is handed to it.
   * When the discard has already ended (its bounded wait for this load ran
   * out, and with no stamp it deleted nothing on the server), this load
   * finishes the discard itself: one conditional DELETE of the revision it
   * read, or a discard marker when that DELETE cannot be confirmed. It does
   * so only while there is still no stamp, so a copy that a later load has
   * adopted in the meantime is left alone.
   */
  private async overtakenLoad(
    sessionId: string,
    adopting?: { userId: string; rev: number },
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    const none = { success: true as const, value: null };
    if (adopting === undefined) return none;
    if (this.discarding.has(sessionId)) {
      this.revSeenByOvertakenLoad.set(sessionId, adopting);
      return none;
    }
    // No discard is running any more. Finish it only where the discard itself
    // would have deleted: in personal mode, for the user who read the copy.
    // (A discard made under an org tenant or signed out clears the cache only.)
    if (this.tenantIdSource() !== null) return none;
    let stamp: LiftStamp | null;
    try {
      if ((await this.userIdSource()) !== adopting.userId) return none;
      stamp = await this.cache.getLiftStamp(sessionId);
    } catch {
      return none;
    }
    if (this.tenantIdSource() !== null) return none;
    // A discard that started during the reads above takes the revision.
    if (this.discarding.has(sessionId)) {
      this.revSeenByOvertakenLoad.set(sessionId, adopting);
      return none;
    }
    // A stamp means a later load adopted the copy. Another load still in
    // flight (this one is itself in the set) may be about to: leave the copy.
    if (stamp !== null) return none;
    if ((this.loadsInFlight.get(sessionId)?.size ?? 0) > 1) return none;
    await this.undoWriteAfterDiscard(sessionId, adopting.userId, adopting.rev);
    return none;
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

  /** True when a discard bumped the id's epoch since the caller captured it. */
  private discardedSince(sessionId: string, epoch: number): boolean {
    return epoch !== (this.epochs.get(sessionId) ?? 0);
  }

  /**
   * Undo a write that landed after a discard bumped the epoch: delete the
   * copy with the rev the write returned; if the delete cannot be confirmed,
   * leave a discard marker so the next load retries the deletion.
   */
  private async undoWriteAfterDiscard(
    sessionId: string,
    userId: string,
    rev: number,
  ): Promise<void> {
    const deleteResult = await this.remote.delete(userId, sessionId, rev);
    if (!deleteResult.ok) {
      if (deleteResult.reason === "conflict") {
        this.logger.warn(
          `workspace ${sessionId}: server copy changed on another device, not deleted`,
        );
        await this.recordConflictEntry(
          sessionId,
          "discard",
          rev,
          deleteResult.serverRev ?? null,
        );
      } else {
        // clean-up DELETE lost (network/429/5xx) → keep a marker so the next
        // load retries the deletion and the discarded workspace does not
        // come back.
        this.logger.warn(
          `workspace ${sessionId}: discard clean-up delete failed: ${deleteResult.message}; keeping marker`,
        );
        await this.tryStamp(sessionId, {
          ownerId: userId,
          rev,
          syncedUpdatedAt: 0,
          confirmed: false,
          discarded: true,
        });
      }
    }
  }

  /**
   * A write got no answer from the server (a timeout, a dropped connection)
   * and a discard has overtaken it: the write may still have been committed.
   * One read decides. When the server holds exactly what this write sent, it
   * landed, and it is deleted like any write a discard overtook. When the
   * read fails too, nothing more is known: if the write did land, the next
   * load shows the workspace again.
   */
  private async undoUnansweredWriteAfterDiscard(
    sessionId: string,
    userId: string,
    sent: PersistedEditorWorkspace,
    result: WriteResult,
  ): Promise<void> {
    if (result.ok) return;
    if (result.reason !== "error" || result.status !== 0) return;
    const confirm = await this.remote.read(userId, sessionId);
    if (!confirm.ok) {
      this.logger.warn(
        `workspace ${sessionId}: a write that a discard overtook got no answer and could not be checked; if it landed, the next load shows it again`,
      );
      return;
    }
    if (!samePayload(confirm.workspace, sent)) return;
    await this.undoWriteAfterDiscard(sessionId, userId, confirm.rev);
  }

  private async loadFromRemote(
    sessionId: string,
    userId: string,
    epochAtStart: number,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    // The discard may have started while the caller awaited the user id.
    // The load still goes on to its reads (they write nothing, and every
    // write below has its own check), so that it can hand the discard the
    // server revision when there is no stamp to delete with. Only the
    // un-pausing is skipped: the discard reads `pausedIds` to decide whether
    // the server copy is its to delete.
    if (!this.discardedSince(sessionId, epochAtStart)) {
      this.pausedIds.delete(sessionId);
      this.forgetConflictState(sessionId);
    }

    // Item 3: wait for any in-flight save PUT so the load's catch-up/maybeLift
    // PUT does not race it on the server.
    const inFlight = this.inFlight.get(sessionId);
    if (inFlight) await inFlight.catch(() => {});

    const cacheResult = await this.cache.loadWorkspace(sessionId);
    if (!cacheResult.success) return cacheResult;

    const readResult = await this.remote.read(userId, sessionId);

    // Item 4: check discard marker before the normal load logic.
    const stamp = await this.cache.getLiftStamp(sessionId);
    // The awaits above only read. Every write below (cache, stamp, conflict
    // record, timer, PUT, DELETE, firstWriteAfter404) stands behind its own
    // discardedSince check, and loadGuarded turns the answer of an overtaken
    // load into "none".
    if (stamp !== null && stamp.ownerId === userId && stamp.discarded) {
      return this.handleDiscardMarker(
        sessionId,
        userId,
        stamp,
        readResult,
        cacheResult,
        epochAtStart,
      );
    }

    if (!readResult.ok) {
      if (readResult.reason === "not_found") {
        if (cacheResult.value !== null) {
          return this.maybeLift(sessionId, userId, cacheResult, epochAtStart);
        }
        if (this.discardedSince(sessionId, epochAtStart))
          return this.overtakenLoad(sessionId);
        this.firstWriteAfter404.add(sessionId);
        return cacheResult;
      }
      if (readResult.reason === "unauthenticated") {
        resetCachedUserId();
      }
      return cacheResult;
    }

    const serverWs = readResult.workspace as PersistedEditorWorkspace;

    if (
      typeof serverWs !== "object" ||
      serverWs === null ||
      (serverWs as { schemaVersion?: unknown }).schemaVersion !== 1
    ) {
      this.logger.warn(
        `workspace ${sessionId} skipped: invalid server payload`,
      );
      return cacheResult;
    }

    if (stamp !== null && stamp.ownerId !== userId) {
      return cacheResult;
    }

    const hasCache = cacheResult.value !== null;

    if (!hasCache) {
      if (await this.cacheStaleSince(sessionId, cacheResult)) {
        return this.cache.loadWorkspace(sessionId);
      }
      if (this.discardedSince(sessionId, epochAtStart))
        return this.overtakenLoad(sessionId, { userId, rev: readResult.rev });
      await this.cache.saveWorkspace(sessionId, serverWs);
      if (this.discardedSince(sessionId, epochAtStart))
        return this.overtakenLoad(sessionId, { userId, rev: readResult.rev });
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
      if (samePayload(cacheEntry, serverWs)) {
        if (this.discardedSince(sessionId, epochAtStart))
          return this.overtakenLoad(sessionId, { userId, rev: readResult.rev });
        await this.tryStamp(sessionId, {
          ownerId: userId,
          rev: readResult.rev,
          syncedUpdatedAt: cacheEntry.updatedAt,
          confirmed: true,
        });
        return cacheResult;
      }
      if (this.discardedSince(sessionId, epochAtStart))
        return { success: true, value: null };
      this.cancelWriteTimer(sessionId);
      await this.recordConflictEntry(sessionId, "load", null, readResult.rev);
      if (this.discardedSince(sessionId, epochAtStart))
        return { success: true, value: null };
      this.logger.warn(
        `workspace ${sessionId} conflict: no stamp, cache differs from server`,
      );
      this.pausedIds.add(sessionId);
      return cacheResult;
    }

    const dirty = cacheEntry.updatedAt !== stamp.syncedUpdatedAt;
    const moved = readResult.rev !== stamp.rev;

    if (!dirty && !moved) {
      if (readResult.rev === stamp.rev && samePayload(serverWs, cacheEntry)) {
        if (this.discardedSince(sessionId, epochAtStart))
          return { success: true, value: null };
        await this.tryStamp(sessionId, { ...stamp, confirmed: true });
      }
      return cacheResult;
    }
    if (!dirty && moved) {
      // Item 8: unconfirmed stamp + moved server → treat as conflict.
      if (!stamp.confirmed) {
        if (this.discardedSince(sessionId, epochAtStart))
          return { success: true, value: null };
        this.cancelWriteTimer(sessionId);
        await this.recordConflictEntry(
          sessionId,
          "load",
          stamp.rev,
          readResult.rev,
        );
        if (this.discardedSince(sessionId, epochAtStart))
          return { success: true, value: null };
        this.logger.warn(
          `workspace ${sessionId} conflict: unconfirmed stamp, server moved (cache rev=${stamp.rev}, server rev=${readResult.rev})`,
        );
        this.pausedIds.add(sessionId);
        return cacheResult;
      }
      if (await this.cacheStaleSince(sessionId, cacheResult)) {
        return this.cache.loadWorkspace(sessionId);
      }
      if (this.discardedSince(sessionId, epochAtStart))
        return { success: true, value: null };
      await this.cache.saveWorkspace(sessionId, serverWs);
      if (this.discardedSince(sessionId, epochAtStart))
        return { success: true, value: null };
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: readResult.rev,
        syncedUpdatedAt: serverWs.updatedAt,
        confirmed: true,
      });
      return { success: true, value: serverWs };
    }
    if (dirty && !moved) {
      return this.catchUp(sessionId, userId, cacheEntry, stamp, epochAtStart);
    }
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
    this.cancelWriteTimer(sessionId);
    await this.recordConflictEntry(
      sessionId,
      "load",
      stamp.rev,
      readResult.rev,
    );
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
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
    epochAtStart: number,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    if (!readResult.ok) {
      if (readResult.reason === "not_found") {
        // GET 404 → the discarded copy is already gone: drop the marker.
        if (this.discardedSince(sessionId, epochAtStart))
          return this.overtakenLoad(sessionId);
        await this.cache.setLiftStamp(sessionId, null);
        if (cacheResult.success && cacheResult.value !== null) {
          return this.maybeLift(sessionId, userId, cacheResult, epochAtStart);
        }
        // No server copy and nothing local: as after any empty load, the
        // first save creates the server copy.
        if (this.discardedSince(sessionId, epochAtStart))
          return this.overtakenLoad(sessionId);
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
      if (this.discardedSince(sessionId, epochAtStart))
        return this.overtakenLoad(sessionId);
      const delResult = await this.remote.delete(userId, sessionId, marker.rev);
      if (delResult.ok) {
        // 204 → dropped; the server copy is gone now.
        if (this.discardedSince(sessionId, epochAtStart))
          return this.overtakenLoad(sessionId);
        await this.cache.setLiftStamp(sessionId, null);
        if (cacheResult.success && cacheResult.value !== null) {
          return this.maybeLift(sessionId, userId, cacheResult, epochAtStart);
        }
        // No server copy and nothing local: as after any empty load, the
        // first save creates the server copy.
        if (this.discardedSince(sessionId, epochAtStart))
          return this.overtakenLoad(sessionId);
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
    if (this.discardedSince(sessionId, epochAtStart))
      return this.overtakenLoad(sessionId);
    await this.cache.setLiftStamp(sessionId, null); // drop marker
    // Overtaken while the marker was dropped: stop here. The second pass
    // would read the other device's copy with no stamp and hand its revision
    // to the discard, which must not delete what another device wrote.
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
    // Hand over to the existing normal load logic with the marker gone.
    return this.loadFromRemote(sessionId, userId, epochAtStart);
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
    // Only the kinds with a server copy to choose against are offered to the
    // user; "discard" and "deleted-elsewhere" stay silent as today.
    if (
      where === "load" ||
      where === "save" ||
      where === "lift" ||
      where === "first-save"
    ) {
      const previous = this.pendingConflicts.get(sessionId);
      this.pendingConflicts.set(sessionId, {
        sessionId,
        where,
        at: new Date().toISOString(),
      });
      if (previous === undefined || previous.where !== where) {
        this.notifyConflictListeners();
      }
    }
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

  getPendingConflict(sessionId: string): PendingWorkspaceConflict | null {
    const entry = this.pendingConflicts.get(sessionId);
    return entry === undefined ? null : { ...entry };
  }

  getSyncPause(sessionId: string): WorkspaceSyncPause | null {
    const entry = this.syncPauses.get(sessionId);
    return entry === undefined ? null : { ...entry };
  }

  /**
   * Only the backups of the signed-in user: another account in the same
   * browser, opening the same project id, is given none of them.
   */
  async listConflictBackups(
    sessionId: string,
  ): Promise<Result<WorkspaceConflictBackup[], PersistenceError>> {
    const userId = await this.userIdSource();
    if (userId === null) return { success: true, value: [] };
    const all = await this.cache.listConflictBackups(sessionId);
    if (!all.success) return all;
    return {
      success: true,
      value: all.value.filter((backup) => backup.ownerId === userId),
    };
  }

  subscribe(listener: () => void): () => void {
    this.conflictListeners.add(listener);
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  private notifyConflictListeners(): void {
    for (const listener of this.conflictListeners) {
      // A listener comes from the interface and is called inside loads,
      // discards and resolves: one that throws must not end any of them.
      try {
        listener();
      } catch (cause) {
        this.logger.warn(
          `a workspace conflict listener threw: ${String(cause)}`,
        );
      }
    }
  }

  /** Records why a paused id has no choice to offer, and tells the listeners. */
  private noteSyncPause(
    sessionId: string,
    reason: WorkspaceSyncPause["reason"],
  ): void {
    this.syncPauses.set(sessionId, {
      sessionId,
      reason,
      at: new Date().toISOString(),
    });
    this.notifyConflictListeners();
  }

  /** Forgets the pending conflict and the pause note of an id; one notification. */
  private forgetConflictState(sessionId: string): void {
    const hadPending = this.pendingConflicts.delete(sessionId);
    const hadPause = this.syncPauses.delete(sessionId);
    if (hadPending || hadPause) this.notifyConflictListeners();
  }

  private resolveFailed(
    message: string,
    kind: "Unknown" | "Conflict" | "NotFound" = "Unknown",
  ): Result<void, PersistenceError> {
    if (kind === "Conflict") {
      return { success: false, error: { kind: "Conflict", message } };
    }
    if (kind === "NotFound") {
      return { success: false, error: { kind: "NotFound", message } };
    }
    return { success: false, error: { kind: "Unknown", message } };
  }

  /**
   * Writes a stamp and reads it back. The cache's stamp write is best-effort
   * and does not report a failure, so the read is the only proof.
   */
  private async stampVerified(
    sessionId: string,
    stamp: LiftStamp,
  ): Promise<boolean> {
    try {
      await this.cache.setLiftStamp(sessionId, stamp);
      const written = await this.cache.getLiftStamp(sessionId);
      return (
        written !== null &&
        written.ownerId === stamp.ownerId &&
        written.rev === stamp.rev &&
        written.syncedUpdatedAt === stamp.syncedUpdatedAt &&
        written.confirmed === stamp.confirmed &&
        !written.discarded
      );
    } catch {
      return false;
    }
  }

  /**
   * Resolve a pending conflict toward the server: back up the server's copy
   * in this browser, PUT the browser copy with the server's current revision
   * as the precondition, confirm it, stamp it.
   */
  keepThisDeviceCopy(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    return this.resolveOnce(sessionId, "keep", (context) =>
      this.runKeepThisDeviceCopy(sessionId, context),
    );
  }

  /**
   * Resolve a pending conflict toward the browser: back up the browser's
   * copy, replace it with the server copy, stamp it confirmed. The caller
   * must load the workspace again afterwards (see the port).
   */
  useOtherDeviceCopy(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    return this.resolveOnce(sessionId, "other", (context) =>
      this.runUseOtherDeviceCopy(sessionId, context),
    );
  }

  /**
   * One resolve per id at a time. Everything up to the registration is
   * synchronous, so two calls in the same tick cannot both start: the second
   * call of the same resolve gets the first one's promise, and the other
   * resolve is refused.
   */
  private resolveOnce(
    sessionId: string,
    kind: "keep" | "other",
    run: (context: ResolveContext) => Promise<Result<void, PersistenceError>>,
  ): Promise<Result<void, PersistenceError>> {
    const running = this.resolving.get(sessionId);
    if (running !== undefined) {
      if (running.kind === kind) return running.promise;
      return Promise.resolve(
        this.resolveFailed(
          `workspace ${sessionId}: the other choice is already being applied`,
        ),
      );
    }
    if (!this.pendingConflicts.has(sessionId)) {
      return Promise.resolve(
        this.resolveFailed(
          `workspace ${sessionId} has no pending conflict`,
          "NotFound",
        ),
      );
    }
    if (this.discarding.has(sessionId)) {
      return Promise.resolve(
        this.resolveFailed(`workspace ${sessionId} is being discarded`),
      );
    }
    const epochAtStart = this.epochs.get(sessionId) ?? 0;
    const entry: {
      kind: "keep" | "other";
      promise: Promise<Result<void, PersistenceError>>;
    } = {
      kind,
      // Replaced two lines below, before anything can read it.
      promise: Promise.resolve(this.resolveFailed("not started")),
    };
    this.resolving.set(sessionId, entry);
    entry.promise = this.resolveGuarded(sessionId, epochAtStart, run).finally(
      () => {
        if (this.resolving.get(sessionId) === entry) {
          this.resolving.delete(sessionId);
        }
      },
    );
    return entry.promise;
  }

  /** What both resolves do first; no write happens here. */
  private async resolveGuarded(
    sessionId: string,
    epochAtStart: number,
    run: (context: ResolveContext) => Promise<Result<void, PersistenceError>>,
  ): Promise<Result<void, PersistenceError>> {
    const discarded = this.resolveFailed(
      `workspace ${sessionId} was discarded; nothing was resolved`,
    );
    if (this.tenantIdSource() !== null) {
      return this.resolveFailed(
        "workspace conflicts cannot be resolved for a tenant user",
      );
    }
    const userId = await this.userIdSource();
    if (userId === null) {
      return this.resolveFailed(
        "workspace conflicts cannot be resolved without a user id",
      );
    }
    // Loads that began before this resolve may still record or clear the
    // conflict: wait for them (bounded). A load that begins from now on waits
    // for this resolve instead (see loadWorkspace).
    const loads = this.loadsInFlight.get(sessionId);
    if (loads !== undefined && loads.size > 0) {
      const ended = await this.settledWithin(loads, DISCARD_LOAD_WAIT_MS);
      if (!ended) {
        return this.resolveFailed(
          `workspace ${sessionId}: a load is still running; choose again`,
        );
      }
    }
    // No timer PUT may race the resolve.
    this.cancelWriteTimer(sessionId);
    const inFlight = this.inFlight.get(sessionId);
    if (inFlight) await inFlight.catch(() => {});
    if (this.discardedSince(sessionId, epochAtStart)) return discarded;
    // A load waited for above may have settled the conflict itself.
    const pending = this.pendingConflicts.get(sessionId);
    if (pending === undefined) {
      return this.resolveFailed(
        `workspace ${sessionId} has no pending conflict`,
        "NotFound",
      );
    }
    return run({ userId, epochAtStart, pending, discarded });
  }

  private async runKeepThisDeviceCopy(
    sessionId: string,
    { userId, epochAtStart, pending, discarded }: ResolveContext,
  ): Promise<Result<void, PersistenceError>> {
    const gone = () => this.discardedSince(sessionId, epochAtStart);

    const readResult = await this.remote.read(userId, sessionId);
    if (gone()) return discarded;
    let precondition: { ifMatch: number } | { createOnly: true };
    if (readResult.ok) {
      precondition = { ifMatch: readResult.rev };
    } else if (readResult.reason === "not_found") {
      // The other copy was deleted meanwhile: nothing to lose, upload as new.
      precondition = { createOnly: true };
    } else {
      if (readResult.reason === "unauthenticated") resetCachedUserId();
      return this.resolveFailed(
        `the server copy could not be read: ${readResult.message}`,
      );
    }

    const local = await this.cache.loadWorkspace(sessionId);
    if (gone()) return discarded;
    if (!local.success || local.value === null) {
      return this.resolveFailed(
        `workspace ${sessionId} has no copy in this browser`,
      );
    }
    const localValue = local.value;

    // The losing copy is kept BEFORE it is overwritten. No backup, no PUT.
    if (readResult.ok && !samePayload(readResult.workspace, localValue)) {
      const backedUp = await this.cache.addConflictBackup({
        sessionId,
        lost: "other-device",
        at: new Date().toISOString(),
        serverRev: readResult.rev,
        ownerId: userId,
        workspace: readResult.workspace as PersistedEditorWorkspace,
      });
      if (gone()) return discarded;
      if (!backedUp.success) {
        return this.resolveFailed(
          `workspace ${sessionId}: the other device's copy could not be backed up; nothing was changed`,
        );
      }
    }

    const putResult = await this.remote.write(
      userId,
      sessionId,
      localValue,
      sessionId,
      precondition,
    );

    // What a discard that overtook the upload calls for. The server held
    // another device's copy, which a discard never deletes (it is paused):
    // that copy is put back. Only when there was no server copy is the
    // upload deleted, like any write a discard overtook.
    const undoAfterDiscard = async (uploadedRev: number): Promise<void> => {
      if (!readResult.ok) {
        await this.undoWriteAfterDiscard(sessionId, userId, uploadedRev);
        return;
      }
      const back = await this.remote.write(
        userId,
        sessionId,
        readResult.workspace,
        sessionId,
        { ifMatch: uploadedRev },
      );
      if (!back.ok) {
        this.logger.warn(
          `workspace ${sessionId}: a discard overtook "keep this device's copy" and the other device's copy could not be put back on the server (${back.message}); it is kept in this browser's backups`,
        );
        // The server still holds what this resolve uploaded: discarded
        // content. Leave a discard marker at that revision, so the next load
        // deletes it instead of taking it for another device's change. (When
        // the server refused the put-back as a conflict, another device has
        // written since and its copy stands.)
        if (back.reason !== "conflict") {
          await this.tryStamp(sessionId, {
            ownerId: userId,
            rev: uploadedRev,
            syncedUpdatedAt: 0,
            confirmed: false,
            discarded: true,
          });
        }
      }
    };

    // `rev` is set only when this browser's copy IS the server's copy now.
    let rev: number;
    let confirmed = false;
    if (putResult.ok) {
      rev = putResult.rev;
      if (gone()) {
        await undoAfterDiscard(rev);
        return discarded;
      }
      const confirm = await this.remote.read(userId, sessionId);
      confirmed =
        confirm.ok &&
        confirm.rev === rev &&
        samePayload(confirm.workspace, localValue);
    } else if (putResult.reason === "conflict") {
      if (gone()) return discarded;
      this.pendingConflicts.set(sessionId, {
        ...pending,
        at: new Date().toISOString(),
      });
      return this.resolveFailed("the other copy changed again", "Conflict");
    } else {
      // The PUT may have been committed and its answer lost: read and compare.
      if (putResult.reason === "unauthenticated") resetCachedUserId();
      const confirm = await this.remote.read(userId, sessionId);
      if (!confirm.ok || !samePayload(confirm.workspace, localValue)) {
        return gone()
          ? discarded
          : this.resolveFailed(
              `the server copy could not be updated: ${putResult.message}`,
            );
      }
      rev = confirm.rev;
      confirmed = true;
    }

    // A discard ran while the requests above were out: what this resolve put
    // on the server is discarded content. Take it off again.
    if (gone()) {
      await undoAfterDiscard(rev);
      return discarded;
    }
    const stamped = await this.stampVerified(sessionId, {
      ownerId: userId,
      rev,
      syncedUpdatedAt: localValue.updatedAt,
      confirmed,
    });
    if (gone()) {
      await undoAfterDiscard(rev);
      return discarded;
    }
    if (!stamped) {
      // Still paused and pending: choosing again repeats the resolve safely.
      return this.resolveFailed(
        `workspace ${sessionId}: this device's copy is on the server and the other copy is kept as a backup, but the choice could not be recorded; choose again`,
      );
    }

    this.pausedIds.delete(sessionId);
    this.forgetConflictState(sessionId);

    // Typed during the resolve: the cache already holds it; arm the normal
    // debounced PUT on the new revision, unless a save has armed one itself.
    const after = await this.cache.loadWorkspace(sessionId);
    if (
      !gone() &&
      !this.discarding.has(sessionId) &&
      !this.pausedIds.has(sessionId) &&
      !this.writeTimers.has(sessionId) &&
      after.success &&
      after.value !== null &&
      after.value.updatedAt !== localValue.updatedAt
    ) {
      this.armRemoteWrite(sessionId, after.value, userId, { ifMatch: rev });
    }
    return { success: true, value: undefined };
  }

  private async runUseOtherDeviceCopy(
    sessionId: string,
    { userId, epochAtStart, discarded }: ResolveContext,
  ): Promise<Result<void, PersistenceError>> {
    const gone = () => this.discardedSince(sessionId, epochAtStart);

    const readResult = await this.remote.read(userId, sessionId);
    if (gone()) return discarded;
    if (!readResult.ok) {
      if (readResult.reason === "unauthenticated") resetCachedUserId();
      return this.resolveFailed(
        readResult.reason === "not_found"
          ? "the other copy no longer exists"
          : `the server copy could not be read: ${readResult.message}`,
      );
    }
    const serverWs = readResult.workspace as PersistedEditorWorkspace;
    if (
      typeof serverWs !== "object" ||
      serverWs === null ||
      (serverWs as { schemaVersion?: unknown }).schemaVersion !== 1
    ) {
      this.logger.warn(
        `workspace ${sessionId} skipped: invalid server payload`,
      );
      return this.resolveFailed("the server copy is invalid");
    }

    // From here until the end, a save of this id writes nothing: the browser
    // copy is being replaced, and a save in between would be lost unseen.
    this.replacingBrowserCopy.add(sessionId);
    this.replacements.set(
      sessionId,
      (this.replacements.get(sessionId) ?? 0) + 1,
    );
    try {
      const previous = await this.cache.loadWorkspace(sessionId);
      if (gone()) return discarded;
      if (!previous.success) {
        return this.resolveFailed(
          `workspace ${sessionId}: the browser copy could not be read; nothing was changed`,
        );
      }

      // The losing copy is kept BEFORE it is overwritten. No backup, no overwrite.
      if (previous.value !== null && !samePayload(previous.value, serverWs)) {
        const backedUp = await this.cache.addConflictBackup({
          sessionId,
          lost: "this-device",
          at: new Date().toISOString(),
          serverRev: readResult.rev,
          ownerId: userId,
          workspace: previous.value,
        });
        if (gone()) return discarded;
        if (!backedUp.success) {
          return this.resolveFailed(
            `workspace ${sessionId}: this device's copy could not be backed up; nothing was changed`,
          );
        }
      }

      // Cache first, stamp second: a stop between the two leaves the server's
      // content under the OLD stamp, which the next load shows as a conflict
      // again. The other order would leave the old content under a stamp that
      // calls it synced, and the next load would upload it over the server's.
      const saved = await this.cache.saveWorkspace(sessionId, serverWs);
      // A discard that began meanwhile waits for this resolve and clears the
      // cache after it.
      if (gone()) return discarded;
      if (!saved.success) {
        return this.resolveFailed(
          `workspace ${sessionId}: the browser copy could not be replaced`,
        );
      }

      const stamped = await this.stampVerified(sessionId, {
        ownerId: userId,
        rev: readResult.rev,
        syncedUpdatedAt: serverWs.updatedAt,
        confirmed: true,
      });
      if (gone()) return discarded;
      // Either way the browser copy is the server's now: the caller reloads.
      this.reloadRequired.add(sessionId);
      if (!stamped) {
        // The browser copy is NOT put back: if the stamp was written after
        // all, the old content under it would be uploaded over the server's.
        // The choice is withdrawn (both buttons would now act on the same
        // content) and the id stays paused until the next load decides.
        this.pendingConflicts.delete(sessionId);
        this.noteSyncPause(sessionId, "choice-not-recorded");
        return this.resolveFailed(
          `workspace ${sessionId}: the other device's copy is in this browser and this device's copy is kept as a backup, but the choice could not be recorded; reload the project`,
        );
      }

      this.pausedIds.delete(sessionId);
      this.forgetConflictState(sessionId);
      return { success: true, value: undefined };
    } finally {
      this.replacingBrowserCopy.delete(sessionId);
    }
  }

  /** 404 path: lift the cache onto the server via an unconditional PUT. */
  private async maybeLift(
    sessionId: string,
    userId: string,
    cacheResult: Result<PersistedEditorWorkspace | null, PersistenceError>,
    epochAtStart: number,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    if (!cacheResult.success || cacheResult.value === null) {
      return cacheResult;
    }
    const cacheEntry = cacheResult.value;
    const stamp = await this.cache.getLiftStamp(sessionId);
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
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
        if (this.discardedSince(sessionId, epochAtStart))
          return { success: true, value: null };
        this.pausedIds.add(sessionId);
        this.noteSyncPause(sessionId, "deleted-elsewhere");
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
    if (this.discardedSince(sessionId, epochAtStart)) {
      // The PUT raced a discard: undo it when it landed, answer "none".
      if (putResult.ok) {
        await this.undoWriteAfterDiscard(sessionId, userId, putResult.rev);
      } else {
        await this.undoUnansweredWriteAfterDiscard(
          sessionId,
          userId,
          cacheEntry,
          putResult,
        );
      }
      return { success: true, value: null };
    }
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
        if (this.discardedSince(sessionId, epochAtStart))
          return { success: true, value: null };
      } else {
        this.logger.warn(
          `workspace ${sessionId} lift PUT failed: ${putResult.message}`,
        );
      }
      this.pausedIds.add(sessionId);
      if (putResult.reason !== "conflict") {
        this.noteSyncPause(sessionId, "upload-failed");
      }
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
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };

    // Item 3: rebase any pending save timer on the new rev so its PUT
    // carries the fresh rev, not the stale one.
    if (this.pendingPreconditions.has(sessionId)) {
      this.pendingPreconditions.set(sessionId, { ifMatch: putRev });
    }

    // Confirming GET — must match rev and payload.
    const confirmResult = await this.remote.read(userId, sessionId);
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
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
    if (!samePayload(confirmResult.workspace, cacheEntry)) {
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
    epochAtStart: number,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
    const putResult = await this.remote.write(
      userId,
      sessionId,
      cacheEntry,
      sessionId,
      { ifMatch: stamp.rev },
    );
    if (this.discardedSince(sessionId, epochAtStart)) {
      // The PUT raced a discard: undo it when it landed, answer "none".
      if (putResult.ok) {
        await this.undoWriteAfterDiscard(sessionId, userId, putResult.rev);
      } else {
        await this.undoUnansweredWriteAfterDiscard(
          sessionId,
          userId,
          cacheEntry,
          putResult,
        );
      }
      return { success: true, value: null };
    }
    if (!putResult.ok) {
      this.logger.warn(
        `workspace ${sessionId} catch-up PUT failed: ${putResult.message}`,
      );
      if (putResult.reason === "conflict") {
        await this.recordConflictEntry(
          sessionId,
          "load",
          stamp.rev,
          putResult.serverRev ?? null,
        );
        if (this.discardedSince(sessionId, epochAtStart))
          return { success: true, value: null };
        this.pausedIds.add(sessionId);
        this.cancelWriteTimer(sessionId);
      } else if (putResult.reason === "unauthenticated") {
        resetCachedUserId();
      }
      return { success: true, value: cacheEntry };
    }
    // Item 7(b): stamp unconfirmed after PUT, before confirming GET.
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putResult.rev,
      syncedUpdatedAt: cacheEntry.updatedAt,
      confirmed: false,
    });
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };

    // Item 3: rebase any pending save timer on the new rev so its PUT
    // carries the fresh rev, not the stale one.
    if (this.pendingPreconditions.has(sessionId)) {
      this.pendingPreconditions.set(sessionId, { ifMatch: putResult.rev });
    }

    const confirmResult = await this.remote.read(userId, sessionId);
    if (this.discardedSince(sessionId, epochAtStart))
      return { success: true, value: null };
    if (!confirmResult.ok) {
      this.logger.warn(`workspace ${sessionId} catch-up confirm failed`);
      return { success: true, value: cacheEntry };
    }
    if (confirmResult.rev !== putResult.rev) {
      this.logger.warn(`workspace ${sessionId} catch-up rev mismatch`);
      return { success: true, value: cacheEntry };
    }
    if (!samePayload(confirmResult.workspace, cacheEntry)) {
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
    // Item 1: a save made while a discard is in flight must not write to the
    // browser cache, lest a discarded workspace be cached without a stamp and
    // revived by a later loadWorkspace.
    if (this.discarding.has(sessionId))
      return { success: true, value: undefined };
    // "Use the other device's copy" is replacing the browser copy right now,
    // or has replaced it and the caller has not loaded it yet: what the
    // caller holds in memory is the copy that lost. The save is refused and
    // says so; it writes nothing.
    const refused = this.saveRefusedByResolve(sessionId);
    if (refused !== null) return refused;
    const replacementsAtStart = this.replacements.get(sessionId) ?? 0;
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
    // A resolve may have begun, or ended, while this save was at the awaits
    // above: its content must not be armed for upload over the copy taken.
    // This relies on the cache keeping the order of its operations (IndexedDB
    // does): this save's cache write was issued before the resolve's read of
    // the browser copy, so the resolve backed it up and replaced it. A cache
    // without that order could leave this save's content under the resolve's
    // stamp, and the next load would upload it.
    const refusedLate = this.saveRefusedByResolve(sessionId);
    if (refusedLate !== null) return refusedLate;
    // The same after the reload: a save that began before a replacement and
    // is still here holds the copy that lost, whatever the guards say now.
    if ((this.replacements.get(sessionId) ?? 0) !== replacementsAtStart) {
      return {
        success: false,
        error: {
          kind: "Conflict",
          message: `workspace ${sessionId}: the other device's copy was taken while this save was under way; it was not sent`,
        },
      };
    }
    this.armRemoteWrite(sessionId, workspace, userId, precondition);

    return cacheResult;
  }

  /** The refusal of a save while a resolve replaces, or has replaced, the browser copy. */
  private saveRefusedByResolve(
    sessionId: string,
  ): Result<void, PersistenceError> | null {
    if (
      !this.replacingBrowserCopy.has(sessionId) &&
      !this.reloadRequired.has(sessionId)
    ) {
      return null;
    }
    return {
      success: false,
      error: {
        kind: "Conflict",
        message: `workspace ${sessionId}: the other device's copy is being taken or was taken; load the workspace again before saving`,
      },
    };
  }

  /** Arms (or re-arms) the debounced server write of an id. */
  private armRemoteWrite(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
    userId: string,
    precondition: { ifMatch: number } | { createOnly: true },
  ): void {
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

      // Item 3 follow-up: a precondition captured as If-Match at schedule
      // time is only valid while that stamp still exists. If the stamp has
      // since gone (cleared) or become this user's discard marker, sending the
      // If-Match would revive discarded content on a stale revision — do not
      // send, and forget the pending precondition for this id. A create-only
      // precondition (first upload, no stamp) is unchanged.
      if (
        "ifMatch" in precondition &&
        (freshStamp === null ||
          (freshStamp.ownerId === userId && freshStamp.discarded))
      ) {
        this.pendingPreconditions.delete(sessionId);
        return;
      }

      // Item 3: a discard may have landed during the stamp read above; do not
      // send content that has already been discarded.
      if (epochAtStart !== (this.epochs.get(sessionId) ?? 0)) return;
      const result = await this.remote.write(
        userId,
        sessionId,
        workspace,
        sessionId,
        precondition,
      );
      if (!result.ok) {
        // No answer and a discard has overtaken this write: it may have landed.
        // The discard is waiting for this write, so the check runs before its
        // own DELETE.
        if (this.discardedSince(sessionId, epochAtStart)) {
          await this.undoUnansweredWriteAfterDiscard(
            sessionId,
            userId,
            workspace,
            result,
          );
        }
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
      if (this.discardedSince(sessionId, epochAtStart)) {
        await this.undoWriteAfterDiscard(sessionId, userId, result.rev);
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
    // runClear marks the id as discarding synchronously, before its first
    // await; the promise is registered here in the same tick so a load of the
    // same id can wait for it.
    const run = this.runClear(sessionId);
    let discards = this.discardsInFlight.get(sessionId);
    if (discards === undefined) {
      discards = new Set();
      this.discardsInFlight.set(sessionId, discards);
    }
    discards.add(run);
    try {
      return await run;
    } finally {
      discards.delete(run);
      if (
        discards.size === 0 &&
        this.discardsInFlight.get(sessionId) === discards
      ) {
        this.discardsInFlight.delete(sessionId);
      }
    }
  }

  private async runClear(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    this.discarding.set(sessionId, (this.discarding.get(sessionId) ?? 0) + 1);
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

      // Wait for every load of the same id that is still running. The epoch
      // is already bumped, so each stops at its next check and writes nothing
      // more; waiting keeps the order simple and lets an overtaken load hand
      // over the server revision it read. The wait is bounded: a load parked
      // on a request that never answers must not hold the discard (and every
      // save of this id, which is refused meanwhile) for ever. A load that
      // starts now waits for this discard and is not in the set.
      const loads = this.loadsInFlight.get(sessionId);
      if (loads !== undefined && loads.size > 0) {
        const ended = await this.settledWithin(loads, DISCARD_LOAD_WAIT_MS);
        if (!ended) {
          this.logger.warn(
            `workspace ${sessionId}: discard went on after ${DISCARD_LOAD_WAIT_MS} ms without the end of a load still in flight`,
          );
        }
      }

      // Wait for a resolve of this id that is still running (bounded, as for
      // loads). The epoch is bumped, so it writes nothing more to the cache
      // or the stamp, and it deletes what its own PUT put on the server.
      const resolve = this.resolving.get(sessionId);
      if (resolve !== undefined) {
        const ended = await this.settledWithin(
          [resolve.promise],
          DISCARD_LOAD_WAIT_MS,
        );
        if (!ended) {
          this.logger.warn(
            `workspace ${sessionId}: discard went on after ${DISCARD_LOAD_WAIT_MS} ms without the end of a conflict resolve still in flight`,
          );
        }
      }
      // A discarded workspace has nothing left to reload.
      this.reloadRequired.delete(sessionId);

      // AM1: org tenant → cache only.
      if (this.tenantIdSource() !== null) {
        return await this.cache.clearWorkspace(sessionId);
      }

      // Check paused BEFORE removing from pausedIds.
      const wasPaused = this.pausedIds.has(sessionId);
      this.pausedIds.delete(sessionId);
      this.forgetConflictState(sessionId);

      const userId = await this.userIdSource();
      if (userId === null) {
        return await this.cache.clearWorkspace(sessionId);
      }

      // Read stamp BEFORE cache clear (server DELETE needs it).
      const stamp = await this.cache.getLiftStamp(sessionId);
      const ownStampRev =
        stamp !== null && stamp.ownerId === userId ? stamp.rev : null;
      // No stamp at all, but a load this discard overtook had read the server
      // copy it was about to adopt: delete that revision (still conditional).
      const handed = this.revSeenByOvertakenLoad.get(sessionId);
      this.revSeenByOvertakenLoad.delete(sessionId);
      const deleteRev =
        ownStampRev ??
        (stamp === null && handed !== undefined && handed.userId === userId
          ? handed.rev
          : null);
      const canDelete = deleteRev !== null && !wasPaused;

      // Cache clear + stamp removal FIRST.
      const cacheResult = await this.cache.clearWorkspace(sessionId);
      this.cancelWriteTimer(sessionId);
      if (!canDelete || deleteRev === null) {
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
        deleteRev,
      );
      if (!deleteResult.ok) {
        if (deleteResult.reason === "conflict") {
          this.logger.warn(
            `workspace ${sessionId}: server copy changed on another device, not deleted`,
          );
          await this.recordConflictEntry(
            sessionId,
            "discard",
            deleteRev,
            deleteResult.serverRev ?? null,
          );
        } else {
          // Item 4: skipped/failed DELETE (not 412) → keep a marker.
          this.logger.warn(
            `workspace ${sessionId}: server delete failed: ${deleteResult.message}; keeping marker`,
          );
          await this.tryStamp(sessionId, {
            ownerId: userId,
            rev: deleteRev,
            syncedUpdatedAt: 0,
            confirmed: false,
            discarded: true,
          });
        }
      }
      return cacheResult;
    } finally {
      const remaining = (this.discarding.get(sessionId) ?? 0) - 1;
      if (remaining <= 0) {
        this.discarding.delete(sessionId);
        this.revSeenByOvertakenLoad.delete(sessionId);
      } else this.discarding.set(sessionId, remaining);
    }
  }
}
