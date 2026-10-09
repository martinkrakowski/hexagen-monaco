import { fetchWithCsrf } from "../csrf-fetch";
import { getActiveTenantId } from "../active-tenant";
import type {
  EditorWorkspacePersistencePort,
  LoggerPort,
  PersistenceError,
  PersistedEditorWorkspace,
  Result,
} from "@hexagen/shared";
import type { LiftStamp } from "./idb-editor-workspace.adapter";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The IDB adapter implements the port plus the stamp primitives; this
 * structural type lets the cached adapter depend on the interface, not the
 * concrete class.
 */
export interface EditorWorkspaceCachePort
  extends EditorWorkspacePersistencePort {
  getLiftStamp(sessionId: string): Promise<LiftStamp | null>;
  setLiftStamp(sessionId: string, stamp: LiftStamp | null): Promise<void>;
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

export type ReadResult = ReadOk | {
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
  | {
      ok: false;
      reason: "unauthenticated" | "rate_limited" | "error";
      status?: number;
      message: string;
    };

export class HttpEditorWorkspaceAdapter {
  /** Last canonical `rev:<n>` seen per id (GET or PUT ETag). */
  private readonly revTokens = new Map<string, number>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetchWithCsrf,
  ) {}

  private documentUrlFor(ownerId: string, id: string): string {
    return `/api/tenants/${encodeURIComponent(ownerId)}/documents/workspace/${encodeURIComponent(id)}`;
  }

  /**
   * GET the remote workspace document. On 200 the rev is seeded from the ETag
   * so a subsequent `write` can carry `If-Match`; on 404 the rev map is left
   * untouched so the first write after a 404 carries no `If-Match`.
   */
  async read(
    ownerId: string,
    id: string,
  ): Promise<ReadResult> {
    try {
      const response = await this.fetchImpl(
        this.documentUrlFor(ownerId, id),
        { headers: { "Content-Type": "application/json" } },
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
      if (rev !== null) this.revTokens.set(id, rev);
      return {
        ok: true,
        workspace: body.payload,
        rev: rev ?? 0,
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
   * `If-Match: rev:<n>` header is sent only when a rev is known for this id
   * (seeded by a prior successful `read` or `write`); a 409 is returned as a
   * conflict without retry.
   */
  async write(
    ownerId: string,
    id: string,
    payload: unknown,
    projectId: string,
  ): Promise<WriteResult> {
    const body = JSON.stringify({ payload, projectId });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const rev = this.revTokens.get(id);
    if (rev !== undefined) {
      headers["If-Match"] = `rev:${rev}`;
    }
    try {
      const response = await this.fetchImpl(
        this.documentUrlFor(ownerId, id),
        { method: "PUT", headers, body },
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
      if (response.status === 409) {
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
      if (newRev !== null) this.revTokens.set(id, newRev);
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
   * DELETE the server-side document. 404 is treated as idempotent success
   * (matching the server's "204 whether or not a row existed" contract).
   */
  async delete(ownerId: string, id: string): Promise<DeleteResult> {
    try {
      const response = await this.fetchImpl(
        this.documentUrlFor(ownerId, id),
        { method: "DELETE" },
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

export class CachedEditorWorkspaceAdapter
  implements EditorWorkspacePersistencePort
{
  /** ids for which a 409 conflict was seen; no remote writes until next load. */
  private readonly pausedIds = new Set<string>();
  /** Per-sessionId debounce timer for the trailing server write. */
  private readonly writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly cache: EditorWorkspaceCachePort,
    private readonly remote: HttpEditorWorkspaceAdapter,
    private readonly tenantIdSource: () => string | null = getActiveTenantId,
    private readonly userIdSource: () => Promise<string | null> = defaultUserIdSource,
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
      this.logger.warn(
        `workspace ${sessionId} skipped: id failed pattern`,
      );
      return this.cache.loadWorkspace(sessionId);
    }
    if (!UUID_PATTERN.test(sessionId)) {
      this.logger.warn(
        `workspace ${sessionId} skipped: id is not a UUID`,
      );
      return this.cache.loadWorkspace(sessionId);
    }
    return this.loadFromRemote(sessionId, userId);
  }

  private async loadFromRemote(
    sessionId: string,
    userId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    const cacheResult = await this.cache.loadWorkspace(sessionId);
    const readResult = await this.remote.read(userId, sessionId);

    if (!readResult.ok) {
      // AM5: any remote failure ends in the cache result.
      if (readResult.reason === "not_found") {
        this.firstWriteAfter404.add(sessionId);
        return this.maybeLift(sessionId, userId, cacheResult);
      }
      return cacheResult;
    }

    const serverWs = readResult.workspace as PersistedEditorWorkspace;
    const stamp = await this.cache.getLiftStamp(sessionId);

    // Foreign stamp: ignore, return cache untouched (not lifted, not deleted).
    if (stamp !== null && stamp.ownerId !== userId) {
      return cacheResult;
    }

    const hasCache =
      cacheResult.success && cacheResult.value !== null;

    // no entry | any → return server value, write to cache, stamp it.
    if (!hasCache) {
      await this.cache.saveWorkspace(sessionId, serverWs);
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: readResult.rev,
        syncedUpdatedAt: serverWs.updatedAt,
      });
      return { success: true, value: serverWs };
    }

    const cacheEntry = cacheResult.value!;
    const hasStamp = stamp !== null;

    if (!hasStamp) {
      // no stamp: conflict or clean depending on payload equality.
      if (JSON.stringify(cacheEntry) === JSON.stringify(serverWs)) {
        await this.tryStamp(sessionId, {
          ownerId: userId,
          rev: readResult.rev,
          syncedUpdatedAt: cacheEntry.updatedAt,
        });
        return cacheResult;
      }
      this.logger.warn(
        `workspace ${sessionId} conflict: no stamp, cache differs from server`,
      );
      this.pausedIds.add(sessionId);
      return cacheResult;
    }

    // has own stamp (and stamp.ownerId === userId)
    const dirty = cacheEntry.updatedAt !== stamp.syncedUpdatedAt;
    const moved = readResult.rev !== stamp.rev;

    if (!dirty && !moved) return cacheResult;
    if (!dirty && moved) {
      await this.cache.saveWorkspace(sessionId, serverWs);
      await this.tryStamp(sessionId, {
        ownerId: userId,
        rev: readResult.rev,
        syncedUpdatedAt: serverWs.updatedAt,
      });
      return { success: true, value: serverWs };
    }
    if (dirty && !moved) {
      return this.catchUp(sessionId, userId, cacheEntry, stamp);
    }
    // dirty && moved → CONFLICT
    this.logger.warn(
      `workspace ${sessionId} conflict: cache dirty and server moved (cache rev=${stamp.rev}, server rev=${readResult.rev})`,
    );
    this.pausedIds.add(sessionId);
    return cacheResult;
  }

  private async tryStamp(
    sessionId: string,
    stamp: LiftStamp,
  ): Promise<void> {
    try {
      await this.cache.setLiftStamp(sessionId, stamp);
    } catch {
      // stamp writes are best-effort
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

    // LIFT: PUT (no If-Match) with the cache value.
    const putResult = await this.remote.write(
      userId,
      sessionId,
      cacheEntry,
      sessionId,
    );
    if (!putResult.ok) {
      this.logger.warn(
        `workspace ${sessionId} lift PUT failed: ${putResult.message}`,
      );
      return cacheResult;
    }
    const putRev = putResult.rev;

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
      JSON.stringify(confirmResult.workspace) !==
      JSON.stringify(cacheEntry)
    ) {
      this.logger.warn(
        `workspace ${sessionId} lift payload mismatch`,
      );
      return cacheResult;
    }

    // Lifted: stamp it. syncedUpdatedAt is the cache entry's updatedAt.
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putRev,
      syncedUpdatedAt: cacheEntry.updatedAt,
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
    );
    if (!putResult.ok) {
      this.logger.warn(
        `workspace ${sessionId} catch-up PUT failed: ${putResult.message}`,
      );
      return { success: true, value: cacheEntry };
    }
    const confirmResult = await this.remote.read(userId, sessionId);
    if (!confirmResult.ok) {
      this.logger.warn(
        `workspace ${sessionId} catch-up confirm failed`,
      );
      return { success: true, value: cacheEntry };
    }
    if (confirmResult.rev !== putResult.rev) {
      this.logger.warn(
        `workspace ${sessionId} catch-up rev mismatch`,
      );
      return { success: true, value: cacheEntry };
    }
    if (
      JSON.stringify(confirmResult.workspace) !==
      JSON.stringify(cacheEntry)
    ) {
      this.logger.warn(
        `workspace ${sessionId} catch-up payload mismatch`,
      );
      return { success: true, value: cacheEntry };
    }
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: putResult.rev,
      syncedUpdatedAt: cacheEntry.updatedAt,
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
    // AM2: after a conflict, no further remote writes until the next load.
    if (this.pausedIds.has(sessionId)) return cacheResult;
    if (stamp === null && !this.firstWriteAfter404.has(sessionId)) {
      return cacheResult;
    }

    const existing = this.writeTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.writeTimers.set(
      sessionId,
      setTimeout(() => {
        void this.doRemoteWrite(sessionId, workspace, userId);
      }, REMOTE_DEBOUNCE_MS),
    );

    return cacheResult;
  }

  private readonly firstWriteAfter404 = new Set<string>();

  private async doRemoteWrite(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
    userId: string,
  ): Promise<void> {
    this.writeTimers.delete(sessionId);
    const result = await this.remote.write(
      userId,
      sessionId,
      workspace,
      sessionId,
    );
    if (!result.ok) {
      switch (result.reason) {
        case "conflict":
          this.logger.warn(
            `workspace ${sessionId} save conflict: one PUT, server rev=${result.serverRev ?? "unknown"}`,
          );
          this.pausedIds.add(sessionId);
          break;
        case "too_large":
          this.logger.warn(
            `workspace ${sessionId} not saved to the server: payload ${result.bodyLength} characters, limit ${MAX_PAYLOAD_LENGTH}`,
          );
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
    await this.tryStamp(sessionId, {
      ownerId: userId,
      rev: result.rev,
      syncedUpdatedAt: workspace.updatedAt,
    });
  }

  async clearWorkspace(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    // Clear any pending debounced remote write for this session.
    const existing = this.writeTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.writeTimers.delete(sessionId);
    }
    this.firstWriteAfter404.delete(sessionId);
    this.pausedIds.delete(sessionId);

    if (this.tenantIdSource() !== null) {
      return this.cache.clearWorkspace(sessionId);
    }

    const userId = await this.userIdSource();

    let serverDelete: Promise<unknown> = Promise.resolve();
    if (userId !== null) {
      const stamp = await this.cache.getLiftStamp(sessionId);
      if (stamp !== null && stamp.ownerId === userId) {
        serverDelete = this.remote
          .delete(userId, sessionId)
          .then((result) => {
            if (!result.ok) {
              this.logger.warn(
                `workspace ${sessionId} server delete failed: ${result.message}`,
              );
            }
          });
      }
    }

    const cacheResult = await this.cache.clearWorkspace(sessionId);
    await serverDelete;
    return cacheResult;
  }
}
