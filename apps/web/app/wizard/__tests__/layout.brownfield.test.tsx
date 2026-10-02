import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  setActive: vi.fn(),
  project: "p1" as string | null,
  projects: [] as Array<Record<string, unknown>>,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ step: "1" }),
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => ({
    get: (k: string) => (k === "project" ? h.project : null),
  }),
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: null,
    setActiveWorkspace: h.setActive,
  }),
}));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({ projects: h.projects, isLoading: false }),
}));
vi.mock("../../../features/workspace-shell/ProjectWorkspace", () => ({
  ProjectWorkspace: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workspace">{children}</div>
  ),
}));
vi.mock("../../../features/workspace-shell/hooks/usePanelToggle", () => ({
  usePanelToggle: () => ({ toggle: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../../features/workspace-shell/hooks/useStepNavigation", () => ({
  useStepNavigation: () => ({ goToStep: vi.fn() }),
}));

import WizardLayout from "../layout";

describe("wizard layout — brownfield ids", () => {
  beforeEach(() => {
    h.replace.mockReset();
    h.setActive.mockReset();
    h.project = "p1";
    h.projects = [
      { id: "p1", name: "Workbook", mode: "brownfield", formState: {} },
      { id: "g1", name: "Green", formState: {}, manifestYaml: "" },
    ];
  });

  it("redirects a brownfield id to the viewer and never sets the active workspace", async () => {
    render(
      <WizardLayout>
        <span>child</span>
      </WizardLayout>,
    );
    await waitFor(() =>
      assert.deepEqual(h.replace.mock.calls, [
        ["/projects/brownfield?project=p1"],
      ]),
    );
    assert.equal(h.setActive.mock.calls.length, 0);
  });

  it("still sets the active workspace for a greenfield id", async () => {
    h.project = "g1";
    render(
      <WizardLayout>
        <span>child</span>
      </WizardLayout>,
    );
    await waitFor(() => assert.equal(h.setActive.mock.calls.length, 1));
    assert.equal(h.replace.mock.calls.length, 0);
    assert.ok(screen.getByText("child"));
  });
});
