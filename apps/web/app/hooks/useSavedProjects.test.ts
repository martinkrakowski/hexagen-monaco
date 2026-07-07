// crypto is a getter-only global in Node (a plain `global.crypto =` throws), so
// stub it via vi.stubGlobal. Distinct ids per call so a returned layer id can be
// matched against the stored layer.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act, waitFor } from "@testing-library/react";

// getSavedProjectsPersistence MUST return a stable reference: it feeds a
// useEffect dep, so a fresh object per call would re-run the load every render.
const persistence = vi.hoisted(() => {
  const state = {
    projects: [] as Array<Record<string, unknown>>,
    failSave: false,
    saveCount: 0,
  };
  const port = {
    loadProjects: async () => ({ success: true, value: state.projects }),
    saveProjects: async (projects: Array<Record<string, unknown>>) => {
      state.saveCount += 1;
      if (state.failSave) {
        return {
          success: false as const,
          error: { kind: "StorageQuotaExceeded", message: "quota" },
        };
      }
      state.projects = projects;
      return { success: true as const, value: undefined };
    },
  };
  return { state, port };
});
vi.mock("../lib/wire.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/wire.client")>()),
  getMigrationReady: vi.fn(async () => {}),
  getSavedProjectsPersistence: vi.fn(() => persistence.port),
}));

import { useSavedProjects } from "./useSavedProjects";

/** A normalized-shape record (layers always present — the port's guarantee). */
function seed(id: string, layers: unknown[] = []): Record<string, unknown> {
  return {
    id,
    name: id,
    schemaVersion: 4,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
    layers,
  };
}

const brainstorm = {
  kind: "brainstorm" as const,
  title: "Vellum",
  turns: [{ id: "t1", author: "Imported", content: "the session" }],
};

async function mountLoaded() {
  const hook = renderHook(() => useSavedProjects());
  await waitFor(() =>
    assert.strictEqual(hook.result.current.projects.length >= 1, true),
  );
  return hook;
}

describe("useSavedProjects — layer mutations", () => {
  beforeEach(() => {
    persistence.state.projects = [];
    persistence.state.failSave = false;
    persistence.state.saveCount = 0;
  });

  it("addLayer stamps identity/timestamps, appends, and persists (round-trip)", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();

    let layerId: string | null = null;
    await act(async () => {
      layerId = await result.current.addLayer("p1", brainstorm);
    });

    assert.ok(layerId, "returns the new layer id on success");
    const p = result.current.projects[0];
    assert.strictEqual(p.layers.length, 1);
    assert.strictEqual(p.layers[0].id, layerId);
    assert.strictEqual(p.layers[0].title, "Vellum");
    assert.strictEqual(typeof p.layers[0].createdAt, "number");
    assert.ok(p.updatedAt > 0, "bumps the project updatedAt");
    // durably written through the port
    const persisted = persistence.state.projects[0] as { layers: unknown[] };
    assert.strictEqual(persisted.layers.length, 1);
  });

  it("addLayer reverts optimistically and surfaces persistError on write failure", async () => {
    persistence.state.projects = [seed("p1")];
    persistence.state.failSave = true;
    const { result } = await mountLoaded();

    let layerId: string | null = "sentinel";
    await act(async () => {
      layerId = await result.current.addLayer("p1", brainstorm);
    });

    assert.strictEqual(layerId, null, "reports failure to the caller");
    assert.strictEqual(
      result.current.projects[0].layers.length,
      0,
      "optimistic layer is reverted",
    );
    assert.ok(result.current.persistError, "persistError is surfaced");
  });

  it("addLayer on an unknown project id is an explicit no-op (no write)", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();
    const before = persistence.state.saveCount;

    let layerId: string | null = "sentinel";
    await act(async () => {
      layerId = await result.current.addLayer("ghost", brainstorm);
    });

    assert.strictEqual(layerId, null);
    assert.strictEqual(
      persistence.state.saveCount,
      before,
      "no whole-array rewrite for a missing id",
    );
  });

  it("updateLayer patches a matched layer and no-ops an unknown one", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "old",
          turns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ];
    const { result } = await mountLoaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.updateLayer("p1", "L1", { title: "new" });
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(result.current.projects[0].layers[0].title, "new");

    let missing = true;
    await act(async () => {
      missing = await result.current.updateLayer("p1", "nope", {
        title: "x",
      });
    });
    assert.strictEqual(missing, false, "unknown layer id → false, no change");
  });

  it("updateLayer ignores explicitly-undefined patch keys (no field clobber)", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "keep me",
          turns: [{ id: "t1", author: "A", content: "c" }],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ];
    const { result } = await mountLoaded();

    let ok = false;
    await act(async () => {
      // TS allows explicit undefined through Partial<>; a bare spread would
      // overwrite required fields and persist an invalid layer.
      ok = await result.current.updateLayer("p1", "L1", {
        title: undefined,
        turns: undefined,
      });
    });

    assert.strictEqual(ok, true);
    const layer = result.current.projects[0].layers[0];
    assert.strictEqual(layer.title, "keep me");
    assert.strictEqual(layer.turns.length, 1);
  });

  it("removeLayer deletes a matched layer and no-ops an unknown one", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "t",
          turns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ];
    const { result } = await mountLoaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.removeLayer("p1", "L1");
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(result.current.projects[0].layers.length, 0);

    let missing = true;
    await act(async () => {
      missing = await result.current.removeLayer("p1", "L1");
    });
    assert.strictEqual(missing, false, "already-gone layer → false");
  });
});
