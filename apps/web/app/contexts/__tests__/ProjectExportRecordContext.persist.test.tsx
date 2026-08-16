// Tests for the publish record's persistence helpers (ADR-0045 follow-up):
// persistGithubLink and persistPublishPrefs must write through the RECORD-level
// `updateProjectRecord` — not a loadProjects pre-read + whole-array
// saveProjects, which persisted a possibly-stale snapshot of every record
// (the original githubLink.lastCommitSha clobber class). NotFound (project
// deleted mid-flow) is a warn + no-op: persistence is best-effort and must
// never fail the publish.
//
// GOD-004 moved these helpers out of ExportContext into
// ProjectExportRecordContext, the one owner of the saved record. The flows are
// still driven through their public entry points (the publish context), so
// what is pinned is end-to-end behavior, not the helper's internals.

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, act, waitFor, cleanup } from "@testing-library/react";

import { ExportProvider } from "../ExportContext";
import {
  useProjectExportRecord,
  type ProjectExportRecordValue,
} from "../ProjectExportRecordContext";
import {
  useGithubPublish,
  type GithubPublishContextValue,
} from "../GithubPublishContext";

const harness = vi.hoisted(() => {
  const state = {
    projects: [] as Array<Record<string, unknown>>,
    loadCalls: 0,
    saveCalls: 0,
    updateCalls: [] as string[],
    warns: [] as string[],
    /** When set, updateProjectRecord fails with this error instead of writing. */
    failWith: null as null | { kind: string; message: string },
  };
  const port = {
    loadProjects: async () => {
      state.loadCalls += 1;
      return { success: true as const, value: state.projects };
    },
    // Whole-array writer — must stay UNUSED by the provider (asserted per test).
    saveProjects: async () => {
      state.saveCalls += 1;
      return { success: true as const, value: undefined };
    },
    updateProjectRecord: async (
      id: string,
      updater: (p: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      state.updateCalls.push(id);
      if (state.failWith) {
        return { success: false as const, error: state.failWith };
      }
      const index = state.projects.findIndex((p) => p.id === id);
      if (index === -1) {
        return {
          success: false as const,
          error: { kind: "NotFound", message: `No saved project ${id}` },
        };
      }
      const updated = updater(state.projects[index]);
      state.projects = state.projects.map((p, i) =>
        i === index ? updated : p,
      );
      return { success: true as const, value: updated };
    },
  };
  const logger = {
    warn: (message: string) => {
      state.warns.push(message);
    },
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  const postJson = vi.fn();
  return { state, port, logger, postJson };
});

// Full factories: the provider reads exactly these named exports, and no
// transitive dependency of this test needs the real wire.client DI container.
vi.mock("@/lib/wire.client", () => ({
  getSavedProjectsPersistence: () => harness.port,
  // No editor session in these tests — loadEditorFiles resolves to {}.
  getEditorWorkspacePersistence: () => ({
    loadWorkspace: async () => ({ success: true as const, value: null }),
  }),
  getLogger: () => harness.logger,
}));
vi.mock("@/lib/fetch-json", () => ({
  postJson: harness.postJson,
  postForBlob: vi.fn(),
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: {
      projectId: "p1",
      name: "Vellum",
      isDirty: false,
      lastModifiedAt: 0,
    },
    setActiveWorkspace: vi.fn(),
    clearActiveWorkspace: vi.fn(),
  }),
}));
vi.mock("@/contexts/ExternalIntegrationContext", () => ({
  useExternalIntegration: () => ({
    isAuthenticated: true,
    signIn: vi.fn(),
  }),
}));

/** A sibling record whose identity must survive every persist untouched. */
let sibling: Record<string, unknown>;

function seedProjects() {
  sibling = { id: "p2", name: "Other", updatedAt: 1 };
  harness.state.projects = [
    // p1 starts UNLINKED (no githubLink) — first-publish topology.
    { id: "p1", name: "Vellum", formState: {}, updatedAt: 1 },
    sibling,
  ];
}

let ctx: GithubPublishContextValue;
let record: ProjectExportRecordValue;
function Capture() {
  ctx = useGithubPublish();
  record = useProjectExportRecord();
  return null;
}

/** Mount the provider and wait for its port-backed mount load to settle. */
async function renderProvider() {
  render(
    <ExportProvider>
      <Capture />
    </ExportProvider>,
  );
  await waitFor(() => {
    assert.ok(harness.state.loadCalls >= 1, "mount load ran");
  });
  return harness.state.loadCalls;
}

const serverLink = {
  owner: "me",
  repo: "r",
  branch: "main",
  defaultBranch: "main",
  lastCommitSha: null,
  htmlUrl: "https://github.com/me/r",
};

function mockScaffoldPublishOk() {
  harness.postJson.mockResolvedValue({
    kind: "success",
    data: {
      destinationUrl: "https://github.com/me/r",
      githubLink: { ...serverLink },
    },
  });
}

describe("ProjectExportRecordContext — record-level persist helpers (ADR-0045 follow-up)", () => {
  beforeEach(() => {
    seedProjects();
    harness.state.loadCalls = 0;
    harness.state.saveCalls = 0;
    harness.state.updateCalls = [];
    harness.state.warns = [];
    harness.state.failWith = null;
    harness.postJson.mockReset();
  });
  afterEach(cleanup);

  it("persistPublishPrefs writes the prefs through updateProjectRecord only — no whole-array save, no extra pre-read, siblings untouched", async () => {
    const loadCallsAfterMount = await renderProvider();

    // scaffold mode with NO linked repo falls through to the create dialog —
    // no network call, so the test isolates the prefs persistence.
    await act(async () => {
      await ctx.submitPublishSettings({
        mode: "scaffold",
        commitMessage: "",
        remember: true,
      });
    });

    assert.deepStrictEqual(harness.state.updateCalls, ["p1"]);
    const stored = harness.state.projects.find((p) => p.id === "p1") as {
      githubPublishPrefs: unknown;
      updatedAt: number;
    };
    assert.deepStrictEqual(stored.githubPublishPrefs, {
      mode: "scaffold",
      remember: true,
    });
    assert.ok(stored.updatedAt > 1, "updatedAt bumped");
    // THE regression pins: the old helper loadProjects-then-saveProjects'd the
    // whole array from a snapshot, clobbering concurrent writers.
    assert.strictEqual(harness.state.saveCalls, 0, "no whole-array write");
    assert.strictEqual(
      harness.state.loadCalls,
      loadCallsAfterMount,
      "the persist path adds no pre-read",
    );
    assert.strictEqual(harness.state.projects[1], sibling);
    // The flow continued past persistence into runMode.
    assert.strictEqual(ctx.state.kind, "dialog-open");
  });

  it("persistPublishPrefs NotFound → warn + no-op, and the flow still continues", async () => {
    await renderProvider();
    harness.state.failWith = { kind: "NotFound", message: "gone" };

    await act(async () => {
      await ctx.submitPublishSettings({
        mode: "scaffold",
        commitMessage: "",
        remember: true,
      });
    });

    assert.deepStrictEqual(harness.state.warns, [
      "Skipped persisting publish prefs — the saved project no longer exists",
    ]);
    // Nothing durably remembered, nothing thrown, and the mode still ran.
    const stored = harness.state.projects.find((p) => p.id === "p1") as {
      githubPublishPrefs?: unknown;
    };
    assert.strictEqual(stored.githubPublishPrefs, undefined);
    assert.strictEqual(ctx.state.kind, "dialog-open");
    assert.strictEqual(harness.state.saveCalls, 0);
  });

  it("a scaffold publish persists the server's githubLink through updateProjectRecord only", async () => {
    mockScaffoldPublishOk();
    const loadCallsAfterMount = await renderProvider();

    await act(async () => {
      await ctx.submitGithubExport({
        repoName: "r",
        isPrivate: false,
        commitMessage: "init",
      });
    });

    assert.deepStrictEqual(harness.state.updateCalls, ["p1"]);
    const stored = harness.state.projects.find((p) => p.id === "p1") as {
      githubLink: unknown;
    };
    assert.deepStrictEqual(stored.githubLink, serverLink);
    assert.strictEqual(harness.state.saveCalls, 0, "no whole-array write");
    assert.strictEqual(
      harness.state.loadCalls,
      loadCallsAfterMount,
      "the persist path adds no pre-read",
    );
    assert.strictEqual(harness.state.projects[1], sibling);
    assert.strictEqual(ctx.state.kind, "success");
    assert.deepStrictEqual(record.connectedRepo, { owner: "me", repo: "r" });
  });

  it("persistGithubLink NotFound → warn + no-op; the publish still reports success (best-effort persistence)", async () => {
    mockScaffoldPublishOk();
    await renderProvider();
    harness.state.failWith = { kind: "NotFound", message: "gone" };

    await act(async () => {
      await ctx.submitGithubExport({
        repoName: "r",
        isPrivate: false,
        commitMessage: "init",
      });
    });

    assert.deepStrictEqual(harness.state.warns, [
      "Skipped persisting GitHub link — the saved project no longer exists",
    ]);
    // The publish outcome is driven by the server response, not the IDB write;
    // the in-memory link was set from the authoritative response regardless.
    assert.strictEqual(ctx.state.kind, "success");
    assert.deepStrictEqual(record.connectedRepo, { owner: "me", repo: "r" });
    assert.strictEqual(harness.state.saveCalls, 0);
  });
});
