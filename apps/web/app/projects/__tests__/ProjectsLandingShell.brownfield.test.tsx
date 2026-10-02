import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  clear: vi.fn(),
  projects: [] as Array<Record<string, unknown>>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({
    projects: h.projects,
    isLoading: false,
    deleteProject: vi.fn(),
    renameProject: vi.fn(),
  }),
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({ clearActiveWorkspace: h.clear }),
}));
vi.mock("@/ProjectsShell", () => ({
  ProjectsShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/landing/ProjectCardGrid", () => ({
  ProjectCardGrid: ({
    projects,
    onLoadProject,
  }: {
    projects: Array<{ id: string; name: string }>;
    onLoadProject: (id: string) => void;
  }) => (
    <>
      {projects.map((p) => (
        <button key={p.id} onClick={() => onLoadProject(p.id)}>
          open {p.name}
        </button>
      ))}
    </>
  ),
}));

import { ProjectsLandingShell } from "../ProjectsLandingShell";

describe("ProjectsLandingShell — opening a card", () => {
  beforeEach(() => {
    h.push.mockReset();
    h.projects = [
      { id: "wb 1", name: "Workbook", mode: "brownfield" },
      { id: "gf-1", name: "Green" },
      { id: "gf-2", name: "ExplicitGreen", mode: "greenfield" },
    ];
  });

  it("routes a brownfield workbook to the viewer, never the wizard", async () => {
    render(<ProjectsLandingShell />);
    await userEvent.click(screen.getByText("open Workbook"));
    assert.deepEqual(h.push.mock.calls, [
      ["/projects/brownfield?project=wb%201"],
    ]);
  });

  it("keeps routing greenfield projects (mode absent or explicit) to the wizard", async () => {
    render(<ProjectsLandingShell />);
    await userEvent.click(screen.getByText("open Green"));
    await userEvent.click(screen.getByText("open ExplicitGreen"));
    assert.deepEqual(h.push.mock.calls, [
      ["/wizard/1?project=gf-1"],
      ["/wizard/1?project=gf-2"],
    ]);
  });
});
