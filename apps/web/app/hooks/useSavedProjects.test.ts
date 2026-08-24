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
    // Counts CALLS, not successful writes — a NotFound resolution never
    // reaches saveProjects, so saveCount alone cannot distinguish "never
    // called the port" from "called it and got NotFound" (review fix).
    updateProjectRecordCount: 0,
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
    // Record-level create, composed over the mutable `port.saveProjects`
    // property so tests that override it (throw/fail) hit this path too.
    // Honors the port contract: duplicate id → Conflict, prepend.
    createProjectRecord: async (project: Record<string, unknown>) => {
      if (state.projects.some((p) => p.id === project.id)) {
        return {
          success: false as const,
          error: { kind: "Conflict", message: `Duplicate id ${project.id}` },
        };
      }
      const written = await port.saveProjects([project, ...state.projects]);
      if (!written.success) return written;
      return { success: true as const, value: project };
    },
    // Record-level delete, composed like create. IDEMPOTENT per the port
    // contract: an absent id resolves success without a write.
    deleteProjectRecord: async (id: string) => {
      const next = state.projects.filter((p) => p.id !== id);
      if (next.length === state.projects.length) {
        return { success: true as const, value: undefined };
      }
      return port.saveProjects(next);
    },
    // Read-merge-write mirror of the real adapters, composed over the mutable
    // `port.saveProjects` property so tests that override it (throw/fail) hit
    // this path too. Honors the port contract: NotFound for a missing id,
    // same-reference return skips the write.
    updateProjectRecord: async (
      id: string,
      updater: (p: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      state.updateProjectRecordCount += 1;
      const index = state.projects.findIndex((p) => p.id === id);
      if (index === -1) {
        return {
          success: false as const,
          error: { kind: "NotFound", message: `No saved project ${id}` },
        };
      }
      const current = state.projects[index];
      const updated = updater(current);
      if (updated === current)
        return { success: true as const, value: current };
      const next = [...state.projects];
      next[index] = updated;
      const written = await port.saveProjects(next);
      if (!written.success) return written;
      return { success: true as const, value: updated };
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

  it("saveProject persists initial layers atomically with the new project", async () => {
    persistence.state.projects = [seed("existing")];
    const { result } = await mountLoaded();

    let id: string | null = null;
    await act(async () => {
      id = await result.current.saveProject("Vellum", {} as never, "yaml: 1", [
        brainstorm,
      ]);
    });

    assert.ok(id, "project created");
    assert.strictEqual(
      persistence.state.saveCount,
      1,
      "one write — capture is part of the same save, not a follow-up",
    );
    const saved = result.current.projects.find((p) => p.id === id);
    assert.ok(saved);
    assert.strictEqual(saved.layers.length, 1);
    assert.strictEqual(saved.layers[0].title, "Vellum");
    assert.ok(saved.layers[0].id, "layer id stamped");
    assert.strictEqual(saved.layers[0].turns[0].content, "the session");
  });

  it("saveProject round-trips optional provenance fields (link, sourceLayerId) on initial layers", async () => {
    // Pins the field-spreading contract the accept-flow provenance write
    // (ManifestAcceptPage → produced-manifest link) depends on: a refactor of
    // saveProject to build layers field-by-field would silently drop the
    // optional Phase-2 fields while every other assertion still passed.
    persistence.state.projects = [seed("existing")];
    const { result } = await mountLoaded();

    let id: string | null = null;
    await act(async () => {
      id = await result.current.saveProject("Vellum", {} as never, "yaml: 1", [
        {
          ...brainstorm,
          link: { type: "produced-manifest" as const, at: 1234 },
          sourceLayerId: "origin-layer",
        },
      ]);
    });

    assert.ok(id, "project created");
    const saved = result.current.projects.find((p) => p.id === id);
    assert.ok(saved);
    assert.deepEqual(saved.layers[0].link, {
      type: "produced-manifest",
      at: 1234,
    });
    assert.strictEqual(saved.layers[0].sourceLayerId, "origin-layer");
    // ...and through the port, not just optimistic state.
    const persisted = persistence.state.projects.find(
      (p) => p.id === id,
    ) as unknown as { layers: Array<Record<string, unknown>> };
    assert.deepEqual(persisted.layers[0].link, {
      type: "produced-manifest",
      at: 1234,
    });
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

  it("addLayer leaves state untouched and surfaces persistError on write failure", async () => {
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
      "failed layer never appears in state",
    );
    assert.ok(result.current.persistError, "persistError is surfaced");
  });

  it("addLayer treats a THROWING port as a failed write (persistError, no escaped rejection)", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();
    const original = persistence.port.saveProjects;
    persistence.port.saveProjects = async () => {
      throw new Error("adapter blew up");
    };

    let layerId: string | null = "sentinel";
    await act(async () => {
      layerId = await result.current.addLayer("p1", brainstorm);
    });
    persistence.port.saveProjects = original;

    assert.strictEqual(layerId, null, "reported as failure, not thrown");
    assert.strictEqual(
      result.current.projects[0].layers.length,
      0,
      "failed layer never appears in state",
    );
    assert.strictEqual(result.current.persistError?.kind, "Unknown");
  });

  it("saveProject treats a THROWING port as a failed write (revert + persistError, no phantom project)", async () => {
    // Without the try/catch the optimistic project stays in state after the
    // caller (ManifestAcceptPage) catches the rejection and retries — the next
    // save then serializes the phantom plus the retry, duplicating it
    // (CodeRabbit #405).
    persistence.state.projects = [seed("existing")];
    const { result } = await mountLoaded();
    const original = persistence.port.saveProjects;
    persistence.port.saveProjects = async () => {
      throw new Error("adapter blew up");
    };

    let id: string | null = "sentinel";
    await act(async () => {
      id = await result.current.saveProject("Vellum", {} as never, "yaml: 1", [
        brainstorm,
      ]);
    });
    persistence.port.saveProjects = original;

    assert.strictEqual(id, null, "reported as failure, not thrown");
    assert.strictEqual(
      result.current.projects.length,
      1,
      "optimistic project is reverted — no phantom left in state",
    );
    assert.strictEqual(result.current.projects[0].id, "existing");
    assert.strictEqual(result.current.persistError?.kind, "Unknown");
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

  it("updateLayer persists a status + link patch (the accept-save done stamp)", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "Live session",
          turns: [],
          status: "finalizing",
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ];
    const { result } = await mountLoaded();

    let ok = false;
    await act(async () => {
      ok = await result.current.updateLayer("p1", "L1", {
        status: "done",
        link: { type: "produced-manifest", at: 123 },
      });
    });

    assert.strictEqual(ok, true);
    const layer = result.current.projects[0].layers[0];
    assert.strictEqual(layer.status, "done");
    assert.deepStrictEqual(layer.link, { type: "produced-manifest", at: 123 });
    // durably written through the port, not just in state
    const persisted = persistence.state.projects[0] as {
      layers: Array<{ status?: string; link?: { type: string } }>;
    };
    assert.strictEqual(persisted.layers[0].status, "done");
    assert.strictEqual(persisted.layers[0].link?.type, "produced-manifest");
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

  it("appendLayerTurn appends one turn (stamped id/at) with an atomic layer patch", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "session",
          turns: [{ id: "t0", author: "Proposer", content: "seed" }],
          createdAt: 1,
          updatedAt: 1,
          status: "proposing",
        },
      ]),
    ];
    const { result } = await mountLoaded();

    // Assigning inside the act() closure leaves `committed` narrowed to its
    // initializer for TS, so capture the awaited value from act() instead.
    const committed = await act(() =>
      result.current.appendLayerTurn(
        "p1",
        "L1",
        { author: "Critic", content: "critique", role: "critic", round: 1 },
        { status: "revising" },
      ),
    );

    assert.ok(committed, "returns the committed turn");
    const layer = result.current.projects[0].layers[0];
    assert.strictEqual(layer.turns.length, 2);
    assert.strictEqual(layer.turns[1].id, committed.id);
    assert.strictEqual(layer.turns[1].role, "critic");
    assert.strictEqual(layer.turns[1].round, 1);
    assert.strictEqual(typeof layer.turns[1].at, "number");
    // The returned turn IS what was persisted — callers mirror this object
    // instead of re-stamping their own `at` (which would diverge).
    assert.strictEqual(layer.turns[1].at, committed.at);
    assert.strictEqual(
      layer.status,
      "revising",
      "status transition lands in the SAME write as the turn",
    );

    let missing: unknown = "sentinel";
    await act(async () => {
      missing = await result.current.appendLayerTurn("p1", "ghost", {
        author: "Critic",
        content: "x",
      });
    });
    assert.strictEqual(missing, null, "unknown layer id → null, no write");
  });

  it("layer mutations merge into the FRESH stored record — a stale hook snapshot cannot clobber another writer's turns", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "session",
          turns: [{ id: "t0", author: "Proposer", content: "seed" }],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ];
    const { result } = await mountLoaded();

    // Another writer (different hook instance / tab) appends a turn directly in
    // storage — this hook's in-memory snapshot is now stale.
    const stored = persistence.state.projects[0] as {
      layers: Array<{ turns: unknown[] }>;
    };
    stored.layers[0].turns = [
      ...stored.layers[0].turns,
      { id: "other-writer", author: "Critic", content: "external" },
    ];

    await act(async () => {
      await result.current.appendLayerTurn("p1", "L1", {
        author: "Human",
        content: "steer",
      });
    });

    const layer = result.current.projects[0].layers[0];
    assert.deepStrictEqual(
      layer.turns.map((t) => t.author),
      ["Proposer", "Critic", "Human"],
      "the external turn survives — merged, not clobbered from the stale snapshot",
    );
  });

  it("updateProject (autosave) merges into the FRESH stored record — a concurrently-landed turn append survives", async () => {
    persistence.state.projects = [
      seed("p1", [
        {
          id: "L1",
          kind: "brainstorm",
          title: "session",
          turns: [{ id: "t0", author: "Proposer", content: "seed" }],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ];
    const { result } = await mountLoaded();

    // A live-session turn append lands in storage after this hook's snapshot
    // was taken (usePlanningSession writes through its own hook instance). The
    // pre-fix updateProject saved its snapshot as a WHOLE ARRAY, which would
    // erase this turn; the record-level write re-reads at write time.
    const stored = persistence.state.projects[0] as {
      layers: Array<{ turns: unknown[] }>;
    };
    stored.layers[0].turns = [
      ...stored.layers[0].turns,
      { id: "in-flight", author: "Critic", content: "landed mid-autosave" },
    ];

    act(() => {
      result.current.updateProject("p1", {} as never, "yaml: 2");
    });
    // updateProject is fire-and-forget — poll the durable store, not the call.
    await waitFor(() =>
      assert.strictEqual(
        (persistence.state.projects[0] as Record<string, unknown>).manifestYaml,
        "yaml: 2",
      ),
    );

    const written = persistence.state.projects[0] as {
      layers: Array<{ turns: Array<{ author: string }> }>;
    };
    assert.deepStrictEqual(
      written.layers[0].turns.map((t) => t.author),
      ["Proposer", "Critic"],
      "the concurrent turn survives — autosave writes one record, not a stale whole-array snapshot",
    );

    // ...and LOCAL state reconciles with the committed record too: the
    // optimistic array was built from a snapshot that predates the turn, so
    // without the success-reconcile the UI would show a stale layer until an
    // unrelated mutation resynced it.
    await waitFor(() => {
      const local = result.current.projects[0];
      assert.strictEqual(local.manifestYaml, "yaml: 2");
      assert.deepStrictEqual(
        local.layers[0].turns.map((t) => t.author),
        ["Proposer", "Critic"],
      );
    });
  });

  it("updateProject treats a THROWING port as a failed write (revert + persistError, no escaped rejection)", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();
    const original = persistence.port.saveProjects;
    persistence.port.saveProjects = async () => {
      throw new Error("adapter exploded");
    };

    act(() => {
      result.current.updateProject("p1", {} as never, "yaml: boom");
    });

    await waitFor(() => assert.ok(result.current.persistError));
    assert.strictEqual(result.current.persistError?.kind, "Unknown");
    assert.strictEqual(
      result.current.projects[0].manifestYaml,
      "",
      "optimistic update reverted",
    );
    persistence.port.saveProjects = original;
  });

  it("updateProject on an id unknown to this instance is a TRUE no-op (no write, no pending entry) — review fix", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();
    const before = persistence.state.saveCount;
    const callsBefore = persistence.state.updateProjectRecordCount;

    await act(async () => {
      result.current.updateProject("ghost", {} as never, "yaml: ghost");
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.strictEqual(persistence.state.saveCount, before, "no write");
    // saveCount alone can't see a wasted call — the port's NotFound arm
    // returns before saveProjects. The no-op must happen BEFORE the port.
    assert.strictEqual(
      persistence.state.updateProjectRecordCount,
      callsBefore,
      "no record-update call at all",
    );
    assert.strictEqual(result.current.persistError, null);
  });

  it("updateProject is a SILENT no-op when the record vanished from storage by write time (NotFound) — review fix", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    // p2 exists in this instance's snapshot but was deleted from storage.
    persistence.state.projects = persistence.state.projects.filter(
      (p) => p.id !== "p2",
    );

    await act(async () => {
      result.current.updateProject("p2", {} as never, "yaml: gone");
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.strictEqual(
      result.current.persistError,
      null,
      "NotFound stays silent (matches renameProject / updateProjectFormState's contract)",
    );
  });
});

describe("useSavedProjects — updateProjectFormState (Plan-phase settings autosave)", () => {
  beforeEach(() => {
    persistence.state.projects = [];
    persistence.state.failSave = false;
    persistence.state.saveCount = 0;
  });

  // A full ProjectConfig isn't needed to exercise the seam — a nested marker
  // object round-trips through the same path (cast, since the port stores it
  // verbatim regardless of shape).
  const settings = { governance: { workspaceName: "Renamed" } } as never;

  function seedRich(): Record<string, unknown> {
    return {
      id: "p1",
      name: "Vellum",
      schemaVersion: 4,
      createdAt: 0,
      updatedAt: 0,
      formState: { governance: { workspaceName: "Original" } },
      manifestYaml: "contexts:\n  - real architecture",
      layers: [
        {
          id: "L1",
          kind: "brainstorm",
          title: "session",
          turns: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
  }

  it("persists ONLY formState — the real manifest and layers are left untouched (round-trip)", async () => {
    persistence.state.projects = [seedRich()];
    const { result } = await mountLoaded();

    // fire-and-forget autosave
    act(() => {
      result.current.updateProjectFormState("p1", settings);
    });

    await waitFor(() =>
      assert.deepStrictEqual(
        (persistence.state.projects[0] as { formState: unknown }).formState,
        { governance: { workspaceName: "Renamed" } },
      ),
    );
    const persisted = persistence.state.projects[0] as Record<string, unknown>;
    assert.strictEqual(
      persisted.manifestYaml,
      "contexts:\n  - real architecture",
      "the generated manifest is NOT regenerated from the form — the whole reason this is not updateProject",
    );
    assert.strictEqual(
      (persisted.layers as unknown[]).length,
      1,
      "layers untouched",
    );

    // ...and local state carries the new formState while keeping the manifest.
    assert.deepStrictEqual(result.current.projects[0].formState, {
      governance: { workspaceName: "Renamed" },
    });
    assert.strictEqual(
      result.current.projects[0].manifestYaml,
      "contexts:\n  - real architecture",
    );
  });

  it("merges into the FRESH stored record — a concurrently-regenerated manifest survives", async () => {
    persistence.state.projects = [seedRich()];
    const { result } = await mountLoaded();

    // Another writer regenerates the architecture in storage AFTER this hook's
    // snapshot was taken. A whole-array write from the stale snapshot would
    // erase it; the record-level updater preserves `base.manifestYaml`.
    (persistence.state.projects[0] as Record<string, unknown>).manifestYaml =
      "regenerated architecture";

    act(() => {
      result.current.updateProjectFormState("p1", settings);
    });

    await waitFor(() =>
      assert.deepStrictEqual(
        (persistence.state.projects[0] as { formState: unknown }).formState,
        { governance: { workspaceName: "Renamed" } },
      ),
    );
    assert.strictEqual(
      (persistence.state.projects[0] as Record<string, unknown>).manifestYaml,
      "regenerated architecture",
      "the fresh stored manifest survives the settings autosave",
    );
    // local state reconciles with the committed record (incl. the sibling manifest)
    await waitFor(() =>
      assert.strictEqual(
        result.current.projects[0].manifestYaml,
        "regenerated architecture",
      ),
    );
  });

  it("is a silent no-op for an unknown/deleted project id (no write, no persistError, no revert)", async () => {
    persistence.state.projects = [seedRich()];
    const { result } = await mountLoaded();
    const before = persistence.state.saveCount;

    // Flush the fire-and-forget async so we can assert nothing changed AFTER it ran.
    await act(async () => {
      result.current.updateProjectFormState("ghost", settings);
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.strictEqual(
      persistence.state.saveCount,
      before,
      "no whole-array rewrite for a missing id",
    );
    assert.strictEqual(
      result.current.persistError,
      null,
      "NotFound stays silent — a late debounced flush against a gone project must not error",
    );
    assert.strictEqual(
      result.current.projects[0].manifestYaml,
      "contexts:\n  - real architecture",
      "the real project is left exactly as it was",
    );
  });

  it("a no-op against an unknown id never bumps the mutation seq — an in-flight write's failure revert still runs", async () => {
    persistence.state.projects = [seedRich()];
    const { result } = await mountLoaded();

    // Hold updateProject's record write in flight behind a gate…
    let releaseWrite: (result: {
      success: false;
      error: { kind: string; message: string };
    }) => void = () => {};
    const original = persistence.port.updateProjectRecord;
    persistence.port.updateProjectRecord = (() =>
      new Promise((resolve) => {
        releaseWrite = resolve;
      })) as typeof original;

    act(() => {
      result.current.updateProject("p1", settings, "autosaved yaml");
    });
    // …then fire the settings autosave against an id that is not in the local
    // array. This must be a TRUE no-op: if it advanced mutationSeq, the gated
    // write's completion below would read a stale seq and skip its revert.
    act(() => {
      result.current.updateProjectFormState("ghost", settings);
    });

    await act(async () => {
      releaseWrite({
        success: false,
        error: { kind: "StorageQuotaExceeded", message: "quota" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.ok(
      result.current.persistError,
      "the in-flight write's failure was reported, not suppressed",
    );
    assert.deepStrictEqual(
      result.current.projects[0].formState,
      { governance: { workspaceName: "Original" } },
      "the failed write's optimistic update was reverted — the ghost no-op did not steal its seq",
    );
    persistence.port.updateProjectRecord = original;
  });

  it("treats a THROWING port as a failed write (revert + persistError, no escaped rejection)", async () => {
    persistence.state.projects = [seedRich()];
    const { result } = await mountLoaded();
    const original = persistence.port.saveProjects;
    persistence.port.saveProjects = async () => {
      throw new Error("adapter exploded");
    };

    act(() => {
      result.current.updateProjectFormState("p1", settings);
    });

    await waitFor(() => assert.ok(result.current.persistError));
    assert.strictEqual(result.current.persistError?.kind, "Unknown");
    assert.deepStrictEqual(
      result.current.projects[0].formState,
      { governance: { workspaceName: "Original" } },
      "optimistic formState update reverted on failure",
    );
    persistence.port.saveProjects = original;
  });

  it("drops a STALE overlapping reconcile — when the first of two writes resolves late, the seq-guard keeps the newer local state", async () => {
    persistence.state.projects = [seedRich()];
    const { result } = await mountLoaded();

    // Gate the FIRST port resolution so it lands after the second completes.
    const originalUpdateRecord = persistence.port.updateProjectRecord;
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((res) => {
      releaseStale = res;
    });
    let recordCalls = 0;
    persistence.port.updateProjectRecord = async (id, updater) => {
      recordCalls += 1;
      if (recordCalls === 1) await staleGate;
      return originalUpdateRecord(id, updater);
    };

    const settingsA = { governance: { workspaceName: "stale-A" } } as never;
    const settingsB = { governance: { workspaceName: "final-B" } } as never;

    act(() => {
      result.current.updateProjectFormState("p1", settingsA);
      // Bumps mutationSeq past A's — A's reconcile is stale from here on.
      result.current.updateProjectFormState("p1", settingsB);
    });

    // The unblocked SECOND write lands and reconciles first.
    await waitFor(() =>
      assert.deepStrictEqual(
        (persistence.state.projects[0] as { formState: unknown }).formState,
        { governance: { workspaceName: "final-B" } },
      ),
    );

    // Now the stale FIRST call resolves. Its late write reaching the adapter
    // is honest last-write-wins at the storage level (the next autosave tick
    // of the same form reconverges it); what the seq-guard owns is the LOCAL
    // reconcile: the stale A record must NOT overwrite the newer B in state.
    releaseStale();
    await waitFor(() =>
      assert.deepStrictEqual(
        (persistence.state.projects[0] as { formState: unknown }).formState,
        { governance: { workspaceName: "stale-A" } },
        "completion probe: the late write reached the adapter",
      ),
    );
    // Give the hook's post-await code (the seq check) a beat to run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepStrictEqual(
      result.current.projects[0].formState,
      { governance: { workspaceName: "final-B" } },
      "the stale A-reconcile was dropped — deleting the seq-guard flips this to stale-A",
    );

    persistence.port.updateProjectRecord = originalUpdateRecord;
  });
});

describe("useSavedProjects — record-level deleteProject / renameProject (ADR-0045 follow-up)", () => {
  beforeEach(() => {
    persistence.state.projects = [];
    persistence.state.failSave = false;
    persistence.state.saveCount = 0;
  });

  it("deleteProject deletes ONE record — a concurrently-created storage record survives", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    // Another hook instance creates a project directly in storage AFTER this
    // instance snapshotted. The pre-fix whole-array save of the filtered
    // snapshot would erase it; deleteProjectRecord touches only the target.
    persistence.state.projects = [
      seed("external"),
      ...persistence.state.projects,
    ];

    act(() => {
      result.current.deleteProject("p2");
    });

    await waitFor(() =>
      assert.deepStrictEqual(
        persistence.state.projects.map((p) => p.id),
        ["external", "p1"],
        "target deleted; the concurrent create survives",
      ),
    );
    assert.strictEqual(result.current.persistError, null);
  });

  it("deleteProject of a row already deleted from storage stays deleted — the idempotent port cannot trip the revert arm", async () => {
    // The D6 pin: if the port surfaced "already gone" as an error, the revert
    // below would resurrect the row in local state.
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    // Another instance already deleted p2 in storage.
    persistence.state.projects = persistence.state.projects.filter(
      (p) => p.id !== "p2",
    );
    const before = persistence.state.saveCount;

    await act(async () => {
      result.current.deleteProject("p2");
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1"],
      "locally deleted row is NOT resurrected",
    );
    assert.strictEqual(result.current.persistError, null, "no error surfaced");
    assert.strictEqual(
      persistence.state.saveCount,
      before,
      "idempotent no-op — no write for an absent id",
    );
  });

  it("deleteProject reverts the optimistic removal and surfaces persistError on write failure", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    persistence.state.failSave = true;
    const { result } = await mountLoaded();

    act(() => {
      result.current.deleteProject("p2");
    });

    await waitFor(() => assert.ok(result.current.persistError));
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1", "p2"],
      "optimistic removal reverted",
    );
  });

  it("deleteProject treats a THROWING port as a failed write (revert + persistError, no escaped rejection)", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();
    const original = persistence.port.saveProjects;
    persistence.port.saveProjects = async () => {
      throw new Error("adapter blew up");
    };

    act(() => {
      result.current.deleteProject("p2");
    });

    await waitFor(() => assert.ok(result.current.persistError));
    persistence.port.saveProjects = original;
    assert.strictEqual(result.current.persistError?.kind, "Unknown");
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1", "p2"],
      "optimistic removal reverted",
    );
  });

  it("renameProject merges into the FRESH stored record — a concurrently-regenerated manifest survives", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();

    // Another writer regenerates the manifest in storage AFTER this hook's
    // snapshot. The pre-fix whole-array save would revert it to "".
    (persistence.state.projects[0] as Record<string, unknown>).manifestYaml =
      "regenerated architecture";

    act(() => {
      result.current.renameProject("p1", "Renamed");
    });

    await waitFor(() =>
      assert.strictEqual(
        (persistence.state.projects[0] as Record<string, unknown>).name,
        "Renamed",
      ),
    );
    assert.strictEqual(
      (persistence.state.projects[0] as Record<string, unknown>).manifestYaml,
      "regenerated architecture",
      "the concurrent sibling-field write survives the rename",
    );
    // Local state reconciles with the committed record (incl. the manifest).
    await waitFor(() => {
      assert.strictEqual(result.current.projects[0].name, "Renamed");
      assert.strictEqual(
        result.current.projects[0].manifestYaml,
        "regenerated architecture",
      );
    });
  });

  it("renameProject on an id unknown to this instance is a TRUE no-op (no write, no seq bump)", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();
    const before = persistence.state.saveCount;

    await act(async () => {
      result.current.renameProject("ghost", "x");
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.strictEqual(persistence.state.saveCount, before, "no write");
    assert.strictEqual(result.current.persistError, null);
  });

  it("renameProject is a SILENT no-op when the record vanished from storage by write time (NotFound)", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    // p2 exists in this instance's snapshot but was deleted from storage.
    persistence.state.projects = persistence.state.projects.filter(
      (p) => p.id !== "p2",
    );

    await act(async () => {
      result.current.renameProject("p2", "Renamed");
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.strictEqual(
      result.current.persistError,
      null,
      "NotFound stays silent (matches updateProjectFormState's contract)",
    );
  });

  it("renameProject reverts the optimistic rename and surfaces persistError on write failure", async () => {
    persistence.state.projects = [seed("p1")];
    persistence.state.failSave = true;
    const { result } = await mountLoaded();

    act(() => {
      result.current.renameProject("p1", "doomed");
    });

    await waitFor(() => assert.ok(result.current.persistError));
    assert.strictEqual(
      result.current.projects[0].name,
      "p1",
      "optimistic rename reverted",
    );
  });
});

describe("useSavedProjects — per-record pending ops (PR #431 follow-up)", () => {
  beforeEach(() => {
    persistence.state.projects = [];
    persistence.state.failSave = false;
    persistence.state.saveCount = 0;
  });

  it("a delete that fails AFTER an unrelated rename began still restores its row (the old global seq suppressed this revert)", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    const originalDelete = persistence.port.deleteProjectRecord;
    let releaseDelete!: (r: {
      success: false;
      error: { kind: string; message: string };
    }) => void;
    persistence.port.deleteProjectRecord = (() =>
      new Promise((resolve) => {
        releaseDelete = resolve;
      })) as typeof originalDelete;

    act(() => {
      result.current.deleteProject("p2");
    });
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1"],
      "optimistic removal applied",
    );

    // A LATER unrelated mutation begins (and lands) while the delete is in
    // flight — under the old global mutationSeq this marked the delete's
    // settle stale and its failure revert never ran.
    act(() => {
      result.current.renameProject("p1", "Renamed");
    });
    await waitFor(() =>
      assert.strictEqual(
        (persistence.state.projects[0] as Record<string, unknown>).name,
        "Renamed",
      ),
    );

    await act(async () => {
      releaseDelete({
        success: false,
        error: { kind: "StorageQuotaExceeded", message: "quota" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.port.deleteProjectRecord = originalDelete;

    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1", "p2"],
      "the failed delete's row IS restored — per-record ownership, not the global seq",
    );
    assert.strictEqual(
      result.current.projects[0].name,
      "Renamed",
      "the unrelated rename's value survives the per-record revert",
    );
    assert.ok(result.current.persistError, "the failure is surfaced");
  });

  it("a create that fails AFTER an unrelated mutation began still removes the phantom project", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();

    const originalCreate = persistence.port.createProjectRecord;
    let releaseCreate!: (r: {
      success: false;
      error: { kind: string; message: string };
    }) => void;
    persistence.port.createProjectRecord = (() =>
      new Promise((resolve) => {
        releaseCreate = resolve;
      })) as typeof originalCreate;

    let savePromise!: Promise<string | null>;
    act(() => {
      savePromise = result.current.saveProject(
        "Phantom",
        {} as never,
        "yaml: x",
      );
    });
    assert.strictEqual(result.current.projects.length, 2, "optimistic prepend");

    act(() => {
      result.current.renameProject("p1", "Renamed");
    });
    await waitFor(() =>
      assert.strictEqual(
        (persistence.state.projects[0] as Record<string, unknown>).name,
        "Renamed",
      ),
    );

    let created: string | null = "sentinel";
    await act(async () => {
      releaseCreate({
        success: false,
        error: { kind: "StorageQuotaExceeded", message: "quota" },
      });
      created = await savePromise;
    });
    persistence.port.createProjectRecord = originalCreate;

    assert.strictEqual(created, null);
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1"],
      "the phantom optimistic create is removed even though a later mutation ran",
    );
    assert.strictEqual(result.current.projects[0].name, "Renamed");
    assert.ok(result.current.persistError);
  });

  it("refresh while ONE record has a pending rename: untouched records take fresh storage state; the pending record keeps its optimistic value, then reconciles on settle", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    const originalUpdate = persistence.port.updateProjectRecord;
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((res) => {
      releaseRename = res;
    });
    persistence.port.updateProjectRecord = async (id, updater) => {
      if (id === "p1") await renameGate;
      return originalUpdate(id, updater);
    };

    act(() => {
      result.current.renameProject("p1", "optimistic");
    });

    // Other-tab writes land in storage while the rename is in flight: p2
    // renamed, p3 created.
    persistence.state.projects = [
      seed("p3"),
      persistence.state.projects.find((p) => p.id === "p1")!,
      { ...seed("p2"), name: "fresh-p2" },
    ];

    await act(async () => {
      await result.current.refreshProjects();
    });

    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p3", "p1", "p2"],
      "fresh ordering applied; the concurrently-created record arrives",
    );
    assert.strictEqual(
      result.current.projects.find((p) => p.id === "p2")?.name,
      "fresh-p2",
      "an untouched record takes the fresh stored value",
    );
    assert.strictEqual(
      result.current.projects.find((p) => p.id === "p1")?.name,
      "optimistic",
      "the record with the pending op keeps its optimistic value",
    );

    await act(async () => {
      releaseRename();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.port.updateProjectRecord = originalUpdate;

    await waitFor(() =>
      assert.strictEqual(
        (
          persistence.state.projects.find((p) => p.id === "p1") as Record<
            string,
            unknown
          >
        ).name,
        "optimistic",
        "the rename landed durably after its gate released",
      ),
    );
    await waitFor(() =>
      assert.strictEqual(
        result.current.projects.find((p) => p.id === "p1")?.name,
        "optimistic",
      ),
    );
    assert.strictEqual(
      result.current.projects.find((p) => p.id === "p2")?.name,
      "fresh-p2",
      "the settle-time reconcile touched only its own record",
    );
  });

  it("a refresh whose read predates a rename that SETTLES mid-refresh cannot clobber the settled record", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();

    // Hold the rename's write…
    const originalUpdate = persistence.port.updateProjectRecord;
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((res) => {
      releaseRename = res;
    });
    persistence.port.updateProjectRecord = async (id, updater) => {
      await renameGate;
      return originalUpdate(id, updater);
    };
    act(() => {
      result.current.renameProject("p1", "Renamed");
    });

    // …and hold a refresh whose read was captured BEFORE the write landed.
    const originalLoad = persistence.port.loadProjects;
    const staleRead = persistence.state.projects; // pre-rename storage snapshot
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((res) => {
      releaseLoad = res;
    });
    persistence.port.loadProjects = async () => {
      await loadGate;
      return { success: true as const, value: staleRead };
    };

    let refreshDone!: Promise<void>;
    act(() => {
      refreshDone = result.current.refreshProjects();
    });

    // The rename lands, reconciles, and SETTLES while the refresh is in flight.
    await act(async () => {
      releaseRename();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      assert.strictEqual(result.current.projects[0].name, "Renamed"),
    );

    // Now the stale read applies. Its data predates the rename's write; the
    // settled-after-read-start guard must keep the local record.
    await act(async () => {
      releaseLoad();
      await refreshDone;
    });
    persistence.port.loadProjects = originalLoad;
    persistence.port.updateProjectRecord = originalUpdate;

    assert.strictEqual(
      result.current.projects[0].name,
      "Renamed",
      "the settled rename survives the stale refresh read (deleting the settled-stamp guard flips this to 'p1')",
    );
  });

  it("refresh preserves a pending create the read missed — the optimistic project is prepended, then lands durably", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();

    const originalCreate = persistence.port.createProjectRecord;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((res) => {
      releaseCreate = res;
    });
    persistence.port.createProjectRecord = async (project) => {
      await createGate;
      return originalCreate(project);
    };

    let savePromise!: Promise<string | null>;
    act(() => {
      savePromise = result.current.saveProject("New", {} as never, "yaml: n");
    });

    await act(async () => {
      await result.current.refreshProjects();
    });

    assert.deepStrictEqual(
      result.current.projects.map((p) => p.name),
      ["New", "p1"],
      "the pending create survives a refresh whose read predates its write",
    );

    let id: string | null = null;
    await act(async () => {
      releaseCreate();
      id = await savePromise;
    });
    persistence.port.createProjectRecord = originalCreate;

    assert.ok(id, "the create resolved successfully after the refresh");
    assert.deepStrictEqual(
      persistence.state.projects.map((p) => p.name),
      ["New", "p1"],
      "the record landed durably",
    );
  });

  it("refresh keeps a pending delete deleted even though the read still saw the row", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    const originalDelete = persistence.port.deleteProjectRecord;
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((res) => {
      releaseDelete = res;
    });
    persistence.port.deleteProjectRecord = async (id) => {
      await deleteGate;
      return originalDelete(id);
    };

    act(() => {
      result.current.deleteProject("p2");
    });

    await act(async () => {
      await result.current.refreshProjects();
    });

    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1"],
      "the optimistic delete's local ABSENCE wins over the fresh row",
    );

    await act(async () => {
      releaseDelete();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.port.deleteProjectRecord = originalDelete;

    await waitFor(() =>
      assert.deepStrictEqual(
        persistence.state.projects.map((p) => p.id),
        ["p1"],
        "the delete landed durably",
      ),
    );
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1"],
    );
    assert.strictEqual(result.current.persistError, null);
  });

  it("two rapid renames on one record: the FIRST op's late reconcile is dropped (per-record seq)", async () => {
    persistence.state.projects = [seed("p1")];
    const { result } = await mountLoaded();

    const originalUpdate = persistence.port.updateProjectRecord;
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((res) => {
      releaseStale = res;
    });
    let recordCalls = 0;
    persistence.port.updateProjectRecord = async (id, updater) => {
      recordCalls += 1;
      if (recordCalls === 1) await staleGate;
      return originalUpdate(id, updater);
    };

    act(() => {
      result.current.renameProject("p1", "stale-A");
      result.current.renameProject("p1", "final-B");
    });

    await waitFor(() =>
      assert.strictEqual(
        (persistence.state.projects[0] as Record<string, unknown>).name,
        "final-B",
      ),
    );

    // The stale first write resolves late. Its late arrival at the adapter is
    // honest last-write-wins at the STORAGE level (same note as the formState
    // suite); the per-record seq owns the LOCAL reconcile.
    releaseStale();
    await waitFor(() =>
      assert.strictEqual(
        (persistence.state.projects[0] as Record<string, unknown>).name,
        "stale-A",
        "completion probe: the late write reached the adapter",
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.port.updateProjectRecord = originalUpdate;

    assert.strictEqual(
      result.current.projects[0].name,
      "final-B",
      "the stale reconcile was dropped — the record's newest op owns local state",
    );
  });

  it("a local delete during a pending rename: the rename settling with success cannot resurrect the row", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    const originalUpdate = persistence.port.updateProjectRecord;
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((res) => {
      releaseRename = res;
    });
    // Resolve the rename as SUCCESS carrying the renamed record even though
    // the row is deleted meanwhile — the strongest resurrection probe (a
    // NotFound resolution would pass even without the ownership guard).
    persistence.port.updateProjectRecord = async () => {
      await renameGate;
      return {
        success: true as const,
        value: { ...seed("p1"), name: "doomed" },
      };
    };

    act(() => {
      result.current.renameProject("p1", "doomed");
    });
    act(() => {
      result.current.deleteProject("p1");
    });
    await waitFor(() =>
      assert.deepStrictEqual(
        persistence.state.projects.map((p) => p.id),
        ["p2"],
        "the delete landed durably",
      ),
    );

    await act(async () => {
      releaseRename();
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.port.updateProjectRecord = originalUpdate;

    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p2"],
      "the settling rename neither resurrects nor reconciles the deleted row",
    );
    assert.strictEqual(result.current.persistError, null);
  });

  it("a record deleted server-side while a rename is pending: the local value survives refresh until the op settles; the NEXT refresh converges", async () => {
    persistence.state.projects = [seed("p1"), seed("p2")];
    const { result } = await mountLoaded();

    const originalUpdate = persistence.port.updateProjectRecord;
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((res) => {
      releaseRename = res;
    });
    persistence.port.updateProjectRecord = async (id, updater) => {
      await renameGate;
      return originalUpdate(id, updater);
    };

    act(() => {
      result.current.renameProject("p1", "doomed");
    });
    // Another tab deletes p1 in storage while the rename write is held.
    persistence.state.projects = persistence.state.projects.filter(
      (p) => p.id !== "p1",
    );

    await act(async () => {
      await result.current.refreshProjects();
    });
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p1", "p2"],
      "the pending record survives the refresh (kept-local rows missing from fresh are prepended)",
    );
    assert.strictEqual(result.current.projects[0].name, "doomed");

    // The rename settles NotFound — silent per the established contract; the
    // row lingers locally until the next refresh.
    await act(async () => {
      releaseRename();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.port.updateProjectRecord = originalUpdate;
    assert.strictEqual(
      result.current.persistError,
      null,
      "NotFound stays silent",
    );

    await act(async () => {
      await result.current.refreshProjects();
    });
    assert.deepStrictEqual(
      result.current.projects.map((p) => p.id),
      ["p2"],
      "with no pending op left, the next refresh converges to server truth",
    );
  });
});
