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

export class HttpSavedProjectsAdapter implements SavedProjectsPersistencePort {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

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
    return { success: true, value: asProjects(result.value) };
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    for (const project of projects) {
      const result = await this.request(`/api/projects/${project.id}`, {
        method: "PUT",
        body: JSON.stringify(project),
      });
      if (!result.success) return result;
    }
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
    return { success: true, value: (result.value as SavedProject) ?? project };
  }

  async updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    const loaded = await this.request(`/api/projects/${id}`);
    if (!loaded.success) return loaded;
    const current = loaded.value as SavedProject;
    const updated = updater(current);
    if (updated === current) return { success: true, value: current };
    const written = await this.request(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(updated),
    });
    if (!written.success) return written;
    return {
      success: true,
      value: (written.value as SavedProject) ?? updated,
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
    if (remote.success) {
      await this.cache.saveProjects(remote.value);
      return remote;
    }
    return this.cache.loadProjects();
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    const remote = await this.remote.saveProjects(projects);
    const local = await this.cache.saveProjects(projects);
    return remote.success ? remote : local;
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
    return this.cache.createProjectRecord(project);
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
    return this.cache.updateProjectRecord(id, updater);
  }

  async deleteProjectRecord(
    id: string,
  ): Promise<Result<void, PersistenceError>> {
    const remote = await this.remote.deleteProjectRecord(id);
    const local = await this.cache.deleteProjectRecord(id);
    return remote.success ? remote : local;
  }
}
