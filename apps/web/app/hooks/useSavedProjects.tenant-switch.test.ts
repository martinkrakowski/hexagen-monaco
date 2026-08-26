// PR #666 review fix (P-U5): a tenant switch while a mutation is in flight.
//
// The switch-triggered refresh deliberately keeps records with pending ops
// (per-record merge), and an op's settle only reconciles its own record — so
// without a drain refresh, the OLD tenant's row stayed visible under the NEW
// tenant until some unrelated refresh happened along. This suite pins the
// drain: when the last pre-switch op settles, one more refresh runs and the
// stale row disappears.
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, renderHook, act, waitFor } from "@testing-library/react";

// Tenant-aware fake port: serves a different list per active tenant, and
// updateProjectRecord blocks until the test releases it.
const harness = vi.hoisted(() => {
  const state = {
    activeTenant: null as string | null,
    listsByTenant: new Map<string | null, Array<Record<string, unknown>>>(),
    releaseUpdate: null as
      | ((result: { success: true; value: Record<string, unknown> }) => void)
      | null,
  };
  const port = {
    loadProjects: async () => ({
      success: true,
      value: state.listsByTenant.get(state.activeTenant) ?? [],
    }),
    saveProjects: async () => ({ success: true as const, value: undefined }),
    createProjectRecord: async (project: Record<string, unknown>) => ({
      success: true as const,
      value: project,
    }),
    deleteProjectRecord: async () => ({
      success: true as const,
      value: undefined,
    }),
    updateProjectRecord: async (
      _id: string,
      updater: (p: Record<string, unknown>) => Record<string, unknown>,
    ) =>
      new Promise<{ success: true; value: Record<string, unknown> }>(
        (resolve) => {
          state.releaseUpdate = resolve;
          void updater;
        },
      ),
  };
  return { state, port };
});
vi.mock("../lib/wire.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/wire.client")>()),
  getMigrationReady: vi.fn(async () => {}),
  getSavedProjectsPersistence: vi.fn(() => harness.port),
}));

import { useSavedProjects } from "./useSavedProjects";
import { setActiveTenantId } from "../lib/active-tenant";

function seed(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    schemaVersion: 4,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
    layers: [],
  };
}

const PERSONAL_ROW = "11111111-1111-4111-8111-11111111aaaa";
const ORG_ROW = "22222222-2222-4222-8222-22222222bbbb";

beforeEach(() => {
  setActiveTenantId(null);
  harness.state.activeTenant = null;
  harness.state.releaseUpdate = null;
  harness.state.listsByTenant = new Map([
    [null, [seed(PERSONAL_ROW)]],
    ["org-1", [seed(ORG_ROW)]],
  ]);
});

afterEach(() => {
  // Unmount FIRST: resetting the tenant notifies store subscribers, and a
  // still-mounted hook would fire one more (outside-act) refresh — the
  // setup-file auto-cleanup runs after this hook, too late.
  cleanup();
  setActiveTenantId(null);
});

describe("useSavedProjects × tenant switch (PR #666 drain refresh)", () => {
  it("a row whose mutation was in flight at switch time disappears when the op settles", async () => {
    const { result } = renderHook(() => useSavedProjects());
    // Flush the mount load inside act before asserting on it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(result.current.isLoading, false);
    assert.deepEqual(
      result.current.projects.map((p) => p.id),
      [PERSONAL_ROW],
    );

    // Start a rename whose port write will NOT resolve yet.
    act(() => {
      result.current.renameProject(PERSONAL_ROW, "renamed");
    });
    await waitFor(() => assert.ok(harness.state.releaseUpdate));

    // Switch tenants mid-flight. The refresh keeps the pending record on
    // purpose — asserting that here proves the drain test is non-vacuous.
    // Async act + macrotask flush so the switch-triggered refresh's apply
    // lands inside act.
    await act(async () => {
      harness.state.activeTenant = "org-1";
      setActiveTenantId("org-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      assert.ok(
        result.current.projects.some((p) => p.id === ORG_ROW),
        "the new tenant's row must arrive",
      ),
    );
    assert.ok(
      result.current.projects.some((p) => p.id === PERSONAL_ROW),
      "the pending record must survive the switch refresh (per-record merge)",
    );

    // Settle the pre-switch op: the drain refresh must clear the stale row.
    // The macrotask flush keeps the drain's async apply inside act.
    await act(async () => {
      harness.state.releaseUpdate?.({
        success: true,
        value: { ...seed(PERSONAL_ROW), name: "renamed" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      assert.deepEqual(
        result.current.projects.map((p) => p.id),
        [ORG_ROW],
        "after the last pre-switch op settles, only the new tenant's rows remain",
      ),
    );
  });

  it("without a switch, a settling op does not trigger a spurious extra load", async () => {
    const loadSpy = vi.spyOn(harness.port, "loadProjects");
    const { result } = renderHook(() => useSavedProjects());
    await waitFor(() => assert.equal(result.current.isLoading, false));
    const loadsBefore = loadSpy.mock.calls.length;

    act(() => {
      result.current.renameProject(PERSONAL_ROW, "renamed");
    });
    await waitFor(() => assert.ok(harness.state.releaseUpdate));
    await act(async () => {
      harness.state.releaseUpdate?.({
        success: true,
        value: { ...seed(PERSONAL_ROW), name: "renamed" },
      });
    });

    await waitFor(() =>
      assert.equal(
        result.current.projects[0]?.name,
        "renamed",
        "the rename must reconcile",
      ),
    );
    assert.equal(
      loadSpy.mock.calls.length,
      loadsBefore,
      "no tenant switch happened, so settling must not re-load the list",
    );
  });
});
