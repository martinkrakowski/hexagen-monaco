import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, act, waitFor } from "@testing-library/react";

// BW-D7: the shared chrome (Header export / GitHub publish) acts on the ACTIVE
// workspace. With real providers, a workspace left active by a previous page
// must be gone once the viewer mounts, so ZIP export is disabled and the GitHub
// scaffold publish is a no-op.
const h = vi.hoisted(() => ({ postJson: vi.fn() }));
vi.mock("@/lib/wire.client", () => ({
  getSavedProjectsPersistence: () => ({
    loadProjects: async () => ({ success: true as const, value: [] }),
    saveProjects: async () => ({ success: true as const, value: undefined }),
    updateProjectRecord: async () => ({
      success: true as const,
      value: {} as Record<string, unknown>,
    }),
  }),
  getEditorWorkspacePersistence: () => ({
    loadWorkspace: async () => ({ success: true as const, value: null }),
  }),
  getLogger: () => ({
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  }),
}));
vi.mock("@/lib/fetch-json", () => ({
  postJson: h.postJson,
  postForBlob: vi.fn(),
}));
vi.mock("@/contexts/ExternalIntegrationContext", () => ({
  useExternalIntegration: () => ({ isAuthenticated: true, signIn: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k === "project" ? "wb-1" : null),
  }),
}));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({
    projects: [{ id: "wb-1", name: "Workbook", mode: "brownfield" }],
    isLoading: false,
  }),
}));

import {
  ActiveWorkspaceProvider,
  useActiveWorkspace,
} from "@/contexts/ActiveWorkspaceContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { useZipExport } from "@/contexts/ZipExportContext";
import { useGithubPublish } from "@/contexts/GithubPublishContext";
import { BrownfieldViewerClient } from "./BrownfieldViewerClient";

describe("brownfield viewer — shared chrome has no workspace to act on", () => {
  beforeEach(() => h.postJson.mockReset());

  it("disables ZIP export and makes the GitHub scaffold publish a no-op", async () => {
    let seed!: ReturnType<typeof useActiveWorkspace>;
    let zip!: ReturnType<typeof useZipExport>;
    let gh!: ReturnType<typeof useGithubPublish>;
    function Probe() {
      seed = useActiveWorkspace();
      zip = useZipExport();
      gh = useGithubPublish();
      return null;
    }

    const ui = (mountViewer: boolean) => (
      <ActiveWorkspaceProvider>
        <ExportProvider>
          <Probe />
          {mountViewer ? <BrownfieldViewerClient /> : null}
        </ExportProvider>
      </ActiveWorkspaceProvider>
    );
    const view = render(ui(false));

    // A greenfield workspace was left active by an earlier page.
    act(() => {
      seed.setActiveWorkspace({
        projectId: "gf-1",
        name: "Green",
        isDirty: false,
        lastModifiedAt: 0,
      });
    });
    await waitFor(() => assert.equal(zip.canExport, true));

    view.rerender(ui(true));
    await waitFor(() => assert.equal(zip.canExport, false));
    assert.equal(seed.activeWorkspace, null);

    await act(async () => {
      await gh.submitGithubExport({
        repoName: "r",
        isPrivate: true,
      } as never);
    });
    assert.equal(h.postJson.mock.calls.length, 0, "no /api/export/github call");
  });
});
