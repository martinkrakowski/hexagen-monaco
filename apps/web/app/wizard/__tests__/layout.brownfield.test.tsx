import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";

// BW-D7. `mounted` records every render of the greenfield subtree. Mocks that
// merely throw would be swallowed by the layout's ErrorBoundary, so the
// assertion is on the record, which cannot be swallowed.
const h = vi.hoisted(() => ({
  replace: vi.fn(),
  setActive: vi.fn(),
  project: "p1" as string | null,
  projects: [] as Array<Record<string, unknown>>,
  isLoading: false,
  active: null as { projectId: string } | null,
  mounted: [] as string[],
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
    activeWorkspace: h.active,
    setActiveWorkspace: h.setActive,
  }),
}));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({
    projects: h.projects,
    isLoading: h.isLoading,
  }),
}));
vi.mock("../../../features/workspace-shell/ProjectWorkspace", () => ({
  ProjectWorkspace: ({ children }: { children: React.ReactNode }) => {
    h.mounted.push("ProjectWorkspace");
    return <div data-testid="workspace">{children}</div>;
  },
}));
vi.mock("../../../features/workspace-shell/hooks/usePanelToggle", () => ({
  usePanelToggle: () => ({ toggle: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../../features/workspace-shell/hooks/useStepNavigation", () => ({
  useStepNavigation: () => ({ goToStep: vi.fn() }),
}));

import WizardLayout from "../layout";

function Child() {
  h.mounted.push("wizard-children");
  return <span>child</span>;
}
const ui = (
  <WizardLayout>
    <Child />
  </WizardLayout>
);

describe("wizard layout — brownfield ids", () => {
  beforeEach(() => {
    h.replace.mockReset();
    h.setActive.mockReset();
    h.mounted.length = 0;
    h.project = "p1";
    h.isLoading = false;
    h.active = null;
    h.projects = [
      { id: "p1", name: "Workbook", mode: "brownfield", formState: {} },
      { id: "g1", name: "Green", formState: {}, manifestYaml: "" },
    ];
  });

  it("redirects a brownfield id, never sets the workspace, and never mounts the shell or children", async () => {
    render(ui);
    await waitFor(() =>
      assert.deepEqual(h.replace.mock.calls, [
        ["/projects/brownfield?project=p1"],
      ]),
    );
    assert.equal(h.setActive.mock.calls.length, 0);
    assert.deepEqual(h.mounted, []);
    assert.ok(screen.getByRole("status"));
  });

  it("mounts neither subtree while the saved projects are still loading", () => {
    h.isLoading = true;
    h.projects = [];
    render(ui);
    assert.deepEqual(h.mounted, []);
    assert.equal(h.replace.mock.calls.length, 0);
  });

  it("checks the mode BEFORE the same-id shortcut: an active workspace with a brownfield id still redirects", async () => {
    h.active = { projectId: "p1" };
    render(ui);
    await waitFor(() => assert.equal(h.replace.mock.calls.length, 1));
    assert.deepEqual(h.mounted, []);
    assert.equal(h.setActive.mock.calls.length, 0);
  });

  it("renders the greenfield shell and sets the workspace for a greenfield id (unchanged)", async () => {
    h.project = "g1";
    render(ui);
    await waitFor(() => assert.equal(h.setActive.mock.calls.length, 1));
    assert.equal(h.replace.mock.calls.length, 0);
    assert.ok(screen.getByText("child"));
    assert.ok(h.mounted.includes("ProjectWorkspace"));
  });

  it("keeps the existing handling for an unknown id: shell renders, nothing set or redirected", () => {
    h.project = "nope";
    render(ui);
    assert.ok(screen.getByText("child"));
    assert.equal(h.setActive.mock.calls.length, 0);
    assert.equal(h.replace.mock.calls.length, 0);
  });
});
