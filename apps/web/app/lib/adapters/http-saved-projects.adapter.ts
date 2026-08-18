import type {
  PersistenceError,
  Result,
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";

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

export class HttpSavedProjectsAdapter
  implements SavedProjectsPersistencePort, OwnerInitializedPort, RemoteOwnerPort
{
  private ownerInitialized = false;
  private ownerId: string | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  isOwnerInitialized(): boolean {
    return this.ownerInitialized;
  }

  currentOwnerId(): string | null {
    return this.ownerId;
  }

  private async request(
    url: string,
    init?: RequestInit,
  ): Promise<Result<unknown, PersistenceError>> {
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
      if (response.status === 204) {
        return { success: true, value: undefined };
      }
      return { success: true, value: await response.json() };
    } catch (cause) {
      return {
        success: false,
        error: persistError("Unknown", "Saved-projects request failed", cause),
      };
    }
  }

  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    const result = await this.request("/api/projects");
    if (!result.success) return result;
    const projects = asProjects(result.value);
    this.ownerInitialized = asInitialized(result.value, projects);
    this.ownerId = asOwnerId(result.value);
    return { success: true, value: projects };
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
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
    const result = await this.request("/api/projects", {
      method: "POST",
      body: JSON.stringify(project),
    });
    if (!result.success) return result;
    this.ownerInitialized = true;
    return { success: true, value: (result.value as SavedProject) ?? project };
  }

  async updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const loaded = await this.request(`/api/projects/${id}`);
      if (!loaded.success) return loaded;
      const current = loaded.value as SavedProject;
      const updated = updater(current);
      if (updated === current) return { success: true, value: current };
      const written = await this.request(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "If-Match": String(current.updatedAt) },
        body: JSON.stringify(updated),
      });
      if (written.success) {
        return {
          success: true,
          value: (written.value as SavedProject) ?? updated,
        };
      }
      if (written.error.kind !== "Conflict" || attempt === maxAttempts - 1) {
        return written;
      }
    }
    return {
      success: false,
      error: persistError("Conflict", "Project was updated elsewhere"),
    };
  }

  async deleteProjectRecord(
    id: string,
  ): Promise<Result<void, PersistenceError>> {
    const result = await this.request(`/api/projects/${id}`, {
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
  ) {}

  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
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
