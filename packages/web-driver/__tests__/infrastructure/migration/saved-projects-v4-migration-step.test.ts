import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import { SavedProjectsV4MigrationStep } from "../../../src/infrastructure/migration/saved-projects-v4-migration-step.js";
import type {
  SavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  Result,
} from "@hexagen/shared";

/** In-memory port; `failSave` forces the persistence write to error. */
class FakePort implements SavedProjectsPersistencePort {
  saveCount = 0;
  failSave = false;
  constructor(public projects: SavedProject[]) {}

  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    return { success: true, value: this.projects };
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    this.saveCount += 1;
    if (this.failSave) {
      return {
        success: false,
        error: { kind: "StorageQuotaExceeded", message: "quota" },
      };
    }
    this.projects = projects;
    return { success: true, value: undefined };
  }

  // Port-contract compliance only — the migration step never touches single
  // records (it stamps whole arrays via saveProjects, the port's
  // migration-only method).
  async updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    const index = this.projects.findIndex((p) => p.id === id);
    if (index === -1) {
      return {
        success: false,
        error: { kind: "NotFound", message: `No saved project with id ${id}` },
      };
    }
    const updated = updater(this.projects[index]);
    this.projects[index] = updated;
    return { success: true, value: updated };
  }

  async createProjectRecord(
    project: SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    if (this.projects.some((p) => p.id === project.id)) {
      return {
        success: false,
        error: {
          kind: "Conflict",
          message: `A saved project with id ${project.id} already exists`,
        },
      };
    }
    this.projects = [project, ...this.projects];
    return { success: true, value: project };
  }

  // Idempotent per the port contract: absent id resolves success.
  async deleteProjectRecord(
    id: string,
  ): Promise<Result<void, PersistenceError>> {
    this.projects = this.projects.filter((p) => p.id !== id);
    return { success: true, value: undefined };
  }
}

function project(id: string, schemaVersion: number): SavedProject {
  return {
    id,
    name: id,
    schemaVersion,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
  };
}

describe("SavedProjectsV4MigrationStep", () => {
  // The step short-circuits when `window` is undefined (SSR safety). Stub it so
  // the browser branch — the real migration logic — actually runs.
  beforeEach(() => {
    vi.stubGlobal("window", {} as unknown as Window);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps pre-v4 records up to 4 and verifies the read-back", async () => {
    const port = new FakePort([project("a", 3), project("b", 3)]);
    const step = new SavedProjectsV4MigrationStep(port);

    const result = await step.migrate();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.recordsMigrated, 2);
    assert.deepStrictEqual(
      port.projects.map((p) => p.schemaVersion),
      [4, 4],
    );
    assert.strictEqual(await step.verify(), true);
  });

  it("is a pure version bump — no data transform, layers untouched", async () => {
    const withLayers = {
      ...project("a", 3),
      layers: [
        {
          id: "L",
          kind: "brainstorm",
          title: "t",
          turns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as SavedProject;
    const port = new FakePort([withLayers]);

    await new SavedProjectsV4MigrationStep(port).migrate();

    assert.strictEqual(port.projects[0].schemaVersion, 4);
    assert.deepStrictEqual(port.projects[0].layers, withLayers.layers);
  });

  it("skips the write entirely when every record is already v4", async () => {
    const port = new FakePort([project("a", 4), project("b", 4)]);
    const step = new SavedProjectsV4MigrationStep(port);

    const result = await step.migrate();

    assert.strictEqual(result.recordsMigrated, 0);
    assert.strictEqual(
      port.saveCount,
      0,
      "no write when nothing needs bumping",
    );
    assert.strictEqual(result.success, true);
  });

  it("verify() is false before migration and true after", async () => {
    const port = new FakePort([project("a", 3)]);
    const step = new SavedProjectsV4MigrationStep(port);

    assert.strictEqual(await step.verify(), false);
    await step.migrate();
    assert.strictEqual(await step.verify(), true);
  });

  it("reports failure when the persistence write fails", async () => {
    const port = new FakePort([project("a", 3)]);
    port.failSave = true;
    const step = new SavedProjectsV4MigrationStep(port);

    const result = await step.migrate();

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.length > 0);
  });

  it("is an SSR no-op when window is undefined", async () => {
    vi.unstubAllGlobals(); // remove the window stub for this case
    const port = new FakePort([project("a", 3)]);
    const step = new SavedProjectsV4MigrationStep(port);

    const result = await step.migrate();

    assert.deepStrictEqual(result, {
      success: true,
      recordsMigrated: 0,
      errors: [],
    });
    assert.strictEqual(port.saveCount, 0);
  });
});
