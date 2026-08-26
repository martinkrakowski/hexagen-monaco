import type {
  PersistenceError,
  Result,
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import { fetchWithCsrf } from "../csrf-fetch";
import { getActiveTenantId } from "../active-tenant";

function persistError(
  kind: PersistenceError["kind"],
  message: string,
  cause?: unknown,
): PersistenceError {
  if (
    kind === "SerializationFailed" ||
    kind === "DeserializationFailed" ||
    kind === "Unknown"
  ) {
    return { kind, message, cause };
  }
  return { kind, message };
}

export const UNAUTHENTICATED_SAVED_PROJECTS_MESSAGE = "Sign in required";

export function isUnauthenticatedPersistenceError(
  error: PersistenceError,
): boolean {
  return (
    error.kind === "Unknown" &&
    (error.message === UNAUTHENTICATED_SAVED_PROJECTS_MESSAGE ||
      /request failed \(40[13]\)/.test(error.message))
  );
}

export interface OwnerInitializedPort {
  isOwnerInitialized(): boolean;
}

export function isOwnerInitializedPort(
  port: SavedProjectsPersistencePort,
): port is SavedProjectsPersistencePort & OwnerInitializedPort {
  return (
    "isOwnerInitialized" in port &&
    typeof (port as OwnerInitializedPort).isOwnerInitialized === "function"
  );
}

export interface RemoteOwnerPort {
  currentOwnerId(): string | null;
}

export function isRemoteOwnerPort(
  port: SavedProjectsPersistencePort,
): port is SavedProjectsPersistencePort & RemoteOwnerPort {
  return (
    "currentOwnerId" in port &&
    typeof (port as RemoteOwnerPort).currentOwnerId === "function"
  );
}

export interface CacheOwnerPort {
  getCacheOwner(): Promise<string | null>;
  setCacheOwner(ownerId: string | null): Promise<void>;
}

export function isCacheOwnerPort(
  port: SavedProjectsPersistencePort,
): port is SavedProjectsPersistencePort & CacheOwnerPort {
  const candidate = port as SavedProjectsPersistencePort &
    Partial<CacheOwnerPort>;
  return (
    typeof candidate.getCacheOwner === "function" &&
    typeof candidate.setCacheOwner === "function"
  );
}

function asProjects(value: unknown): SavedProject[] {
  if (Array.isArray(value)) return value as SavedProject[];
  if (
    value &&
    typeof value === "object" &&
    "projects" in value &&
    Array.isArray((value as { projects: unknown }).projects)
  ) {
    return (value as { projects: SavedProject[] }).projects;
  }
  return [];
}

function asInitialized(value: unknown, projects: SavedProject[]): boolean {
  if (
    value &&
    typeof value === "object" &&
    "initialized" in value &&
    typeof (value as { initialized: unknown }).initialized === "boolean"
  ) {
    return (value as { initialized: boolean }).initialized;
  }
  return projects.length > 0;
}

function asOwnerId(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "ownerId" in value &&
    typeof (value as { ownerId: unknown }).ownerId === "string"
  ) {
    const ownerId = (value as { ownerId: string }).ownerId.trim();
    return ownerId.length > 0 ? ownerId : null;
  }
  return null;
}

/** Strip RFC 7232 quoting / weakness so a GET/PUT ETag becomes `rev:<n>`. */
function revTokenFromEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  const trimmed = etag.trim().replace(/^W\//, "").replaceAll('"', "");
  return /^rev:\d+$/.test(trimmed) ? trimmed : null;
}

interface HttpBody {
  body: unknown;
  etag: string | null;
}

export class HttpSavedProjectsAdapter
  implements SavedProjectsPersistencePort, OwnerInitializedPort, RemoteOwnerPort
{
  private ownerInitialized = false;
  private ownerId: string | null = null;
  /** Last canonical `rev:<n>` seen per project (GET or PUT ETag). */
  private readonly revTokens = new Map<string, string>();

  // Default transport is the D-H7 CSRF-aware fetch: every mutation this
  // adapter issues is cookie-authenticated, so it must echo the double-submit
  // header (app/lib/csrf-fetch.ts). Tests that inject their own fetchImpl are
  // unaffected — the helper only wraps the DEFAULT transport.
  //
  // `tenantIdSource` defaults to the module-level active-tenant store (P-U5):
  // this adapter is a wire.client singleton constructed once at module scope,
  // so tenant selection must be read per REQUEST through a getter, never
  // captured at construction time.
  constructor(
    private readonly fetchImpl: typeof fetch = fetchWithCsrf,
    private readonly tenantIdSource: () => string | null = getActiveTenantId,
  ) {}

  /**
   * The ONE place request URLs are derived (P-U5). Personal tenant (null)
   * keeps the historical `/api/projects...` alias; an org id addresses the
   * tenant-scoped routes, which run the same shared handlers server-side
   * (app/lib/project-route-handlers.ts, D-A8).
   */
  private projectsUrl(suffix = ""): string {
    const tenantId = this.tenantIdSource();
    if (tenantId === null) return `/api/projects${suffix}`;
    return `/api/tenants/${encodeURIComponent(tenantId)}/projects${suffix}`;
  }

  isOwnerInitialized(): boolean {
    return this.ownerInitialized;
  }

  currentOwnerId(): string | null {
    return this.ownerId;
  }

  private async request(
    url: string,
    init?: RequestInit,
  ): Promise<Result<HttpBody, PersistenceError>> {
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: persistError(
            "Unknown",
            UNAUTHENTICATED_SAVED_PROJECTS_MESSAGE,
          ),
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: persistError("NotFound", `Not found: ${url}`),
        };
      }
      if (response.status === 409) {
        return {
          success: false,
          error: persistError("Conflict", "Project already exists"),
        };
      }
      if (!response.ok) {
        return {
          success: false,
          error: persistError(
            "Unknown",
            `Saved-projects request failed (${response.status})`,
          ),
        };
      }
      const etag = response.headers.get("ETag");
      if (response.status === 204) {
        return { success: true, value: { body: undefined, etag } };
      }
      return {
        success: true,
        value: { body: await response.json(), etag },
      };
    } catch (cause) {
      return {
        success: false,
        error: persistError("Unknown", "Saved-projects request failed", cause),
      };
    }
  }

  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    const result = await this.request(this.projectsUrl());
    if (!result.success) return result;
    const projects = asProjects(result.value.body);
    this.ownerInitialized = asInitialized(result.value.body, projects);
    this.ownerId = asOwnerId(result.value.body);
    return { success: true, value: projects };
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    // Whole-list replacement exists ONLY on the personal alias — the tenant
    // routes deliberately expose no collection PUT (an org's list is shared
    // state; replacing it wholesale from one member's browser would clobber
    // everyone). Refusing here, instead of PUTting a nonexistent route, keeps
    // the failure typed and keeps stray boot-time writers (migrations) from
    // ever bulk-writing into an org.
    if (this.tenantIdSource() !== null) {
      return {
        success: false,
        error: persistError(
          "Unknown",
          "Replacing the whole project list is personal-tenant-only",
        ),
      };
    }
    const result = await this.request("/api/projects", {
      method: "PUT",
      body: JSON.stringify({ projects }),
    });
    if (!result.success) return result;
    this.ownerInitialized = true;
    return { success: true, value: undefined };
  }

  async createProjectRecord(
    project: SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    const result = await this.request(this.projectsUrl(), {
      method: "POST",
      body: JSON.stringify(project),
    });
    if (!result.success) return result;
    this.ownerInitialized = true;
    return {
      success: true,
      value: (result.value.body as SavedProject) ?? project,
    };
  }

  async updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    // H1.4: ONE write attempt. This loop used to re-read and re-write up to
    // three times on a 409, which is how a co-editor's change disappears: the
    // updater is re-applied to freshly-read state and the second write wins
    // silently. A 409 is a decision by the server, not a transient blip, so it
    // is surfaced to the caller instead of being retried away. The
    // reload-and-merge UI that consumes it is P-A5.
    const loaded = await this.request(this.projectsUrl(`/${id}`));
    if (!loaded.success) return loaded;
    const current = loaded.value.body as SavedProject;
    const updated = updater(current);
    if (updated === current) return { success: true, value: current };
    const fromGet = revTokenFromEtag(loaded.value.etag);
    if (fromGet) this.revTokens.set(id, fromGet);
    // Canonical token from GET (or a prior PUT) first; legacy `updatedAt`
    // only when the server has not yet advertised a rev ETag.
    const ifMatch = this.revTokens.get(id) ?? String(current.updatedAt);
    const written = await this.request(this.projectsUrl(`/${id}`), {
      method: "PUT",
      headers: { "If-Match": ifMatch },
      body: JSON.stringify(updated),
    });
    if (written.success) {
      const fromPut = revTokenFromEtag(written.value.etag);
      if (fromPut) this.revTokens.set(id, fromPut);
      return {
        success: true,
        value: (written.value.body as SavedProject) ?? updated,
      };
    }
    return written;
  }

  async deleteProjectRecord(
    id: string,
  ): Promise<Result<void, PersistenceError>> {
    const result = await this.request(this.projectsUrl(`/${id}`), {
      method: "DELETE",
    });
    if (!result.success && result.error.kind === "NotFound") {
      return { success: true, value: undefined };
    }
    if (!result.success) return result;
    return { success: true, value: undefined };
  }
}

/**
 * Server is authoritative when reachable; IDB (or any local port) is the cache.
 */
export class CachedSavedProjectsAdapter implements SavedProjectsPersistencePort {
  constructor(
    private readonly cache: SavedProjectsPersistencePort,
    private readonly remote: SavedProjectsPersistencePort,
    // Same getter the HTTP adapter derives its URLs from, so the two can
    // never disagree about which tenant a request belongs to.
    private readonly tenantIdSource: () => string | null = getActiveTenantId,
  ) {}

  /**
   * H1.7: the IDB cache is PERSONAL-TENANT-ONLY. When an org tenant is
   * active every operation goes remote-only — a remote failure surfaces as
   * an error instead of falling back to the cache, because the cache holds
   * the personal tenant's projects and serving them here would silently
   * render the WRONG tenant's data. The cache is neither read nor written
   * while an org is active, so it stays a faithful personal-tenant mirror.
   */
  private orgTenantActive(): boolean {
    return this.tenantIdSource() !== null;
  }

  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    if (this.orgTenantActive()) return this.remote.loadProjects();
    const remote = await this.remote.loadProjects();
    if (!remote.success) return this.cache.loadProjects();
    const initialized = isOwnerInitializedPort(this.remote)
      ? this.remote.isOwnerInitialized()
      : remote.value.length > 0;
    const remoteOwner = isRemoteOwnerPort(this.remote)
      ? this.remote.currentOwnerId()
      : null;
    const cacheOwner = isCacheOwnerPort(this.cache)
      ? await this.cache.getCacheOwner()
      : null;
    // First-deploy / first-sign-in only: an uninitialized empty remote is
    // not an intentional delete. After the owner has replaced once, empty
    // remote wins so a stale IDB cannot resurrect deleted projects.
    // Never lift a cache stamped for a different authenticated owner.
    if (remote.value.length === 0 && !initialized) {
      const cached = await this.cache.loadProjects();
      if (cached.success && cached.value.length > 0) {
        if (cacheOwner && cacheOwner !== remoteOwner) {
          await this.cache.saveProjects([]);
          await this.stampCacheOwner(remoteOwner);
          return remote;
        }
        await this.remote.saveProjects(cached.value);
        await this.stampCacheOwner(remoteOwner);
        return cached;
      }
    }
    await this.cache.saveProjects(remote.value);
    await this.stampCacheOwner(remoteOwner);
    return remote;
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    if (this.orgTenantActive()) return this.remote.saveProjects(projects);
    const remote = await this.remote.saveProjects(projects);
    if (remote.success) {
      await this.cache.saveProjects(projects);
      return remote;
    }
    if (isUnauthenticatedPersistenceError(remote.error)) {
      return this.cache.saveProjects(projects);
    }
    return remote;
  }

  async createProjectRecord(
    project: SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    if (this.orgTenantActive()) return this.remote.createProjectRecord(project);
    const remote = await this.remote.createProjectRecord(project);
    if (remote.success) {
      const updated = await this.cache.updateProjectRecord(
        remote.value.id,
        () => remote.value,
      );
      if (!updated.success) {
        await this.cache.createProjectRecord(remote.value);
      }
      return remote;
    }
    if (isUnauthenticatedPersistenceError(remote.error)) {
      return this.cache.createProjectRecord(project);
    }
    return remote;
  }

  async updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    if (this.orgTenantActive()) {
      return this.remote.updateProjectRecord(id, updater);
    }
    const remote = await this.remote.updateProjectRecord(id, updater);
    if (remote.success) {
      await this.cache.updateProjectRecord(id, () => remote.value);
      return remote;
    }
    if (isUnauthenticatedPersistenceError(remote.error)) {
      return this.cache.updateProjectRecord(id, updater);
    }
    return remote;
  }

  async deleteProjectRecord(
    id: string,
  ): Promise<Result<void, PersistenceError>> {
    if (this.orgTenantActive()) return this.remote.deleteProjectRecord(id);
    const remote = await this.remote.deleteProjectRecord(id);
    if (remote.success) {
      await this.cache.deleteProjectRecord(id);
      return remote;
    }
    if (isUnauthenticatedPersistenceError(remote.error)) {
      return this.cache.deleteProjectRecord(id);
    }
    return remote;
  }

  private async stampCacheOwner(ownerId: string | null): Promise<void> {
    if (isCacheOwnerPort(this.cache)) {
      await this.cache.setCacheOwner(ownerId);
    }
  }
}
