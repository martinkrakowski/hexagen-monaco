import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";

// BW-D7: the viewer mounts none of the greenfield write surfaces. Each is
// mocked to THROW if it is rendered or called, so importing-and-mounting any
// one of them fails this suite.
const forbidden = vi.hoisted(() => ({
  hit: [] as string[],
}));
vi.mock("@/governance-assistant/GovernancePanelWrapper", () => ({
  GovernancePanelWrapper: () => {
    forbidden.hit.push("GovernancePanelWrapper");
    throw new Error("GovernancePanelWrapper must not mount");
  },
}));
vi.mock("@/workspace-shell/hooks/useEditorPush", () => ({
  useEditorPush: () => {
    forbidden.hit.push("useEditorPush");
    throw new Error("useEditorPush must not be called");
  },
}));
vi.mock("@/workspace-shell/hooks/useProjectGenerationFlow", () => ({
  useProjectGenerationFlow: () => {
    forbidden.hit.push("useProjectGenerationFlow");
    throw new Error("useProjectGenerationFlow must not be called");
  },
}));

const state = vi.hoisted(() => ({
  project: "wb-1" as string | null,
  projects: [] as Array<Record<string, unknown>>,
  isLoading: false,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k === "project" ? state.project : null),
  }),
}));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({
    projects: state.projects,
    isLoading: state.isLoading,
  }),
}));

import { BrownfieldViewerClient } from "./BrownfieldViewerClient";

describe("brownfield viewer page", () => {
  beforeEach(() => {
    forbidden.hit.length = 0;
    state.project = "wb-1";
    state.isLoading = false;
    state.projects = [
      { id: "wb-1", name: "Client engagement", mode: "brownfield" },
      { id: "gf-1", name: "Greenfield app" },
    ];
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the workbook name, the later-lane note and the CLI steps as text", () => {
    render(<BrownfieldViewerClient />);
    assert.ok(screen.getByText("Client engagement"));
    assert.ok(screen.getByText(/bundle viewer arrives in a later release/i));
    for (const step of [
      "Checkout",
      "Observe",
      "Slice",
      "Contract",
      "Grant",
      "Evidence",
    ]) {
      assert.ok(screen.getByText(step), step);
    }
    assert.equal(screen.queryAllByRole("button").length, 0, "no controls");
  });

  it("mounts none of GovernancePanelWrapper, useEditorPush, the generate flow, and calls no route", () => {
    render(<BrownfieldViewerClient />);
    assert.deepEqual(forbidden.hit, []);
    assert.equal(vi.mocked(fetch).mock.calls.length, 0);
  });

  it("does not render a greenfield project as a workbook", () => {
    state.project = "gf-1";
    render(<BrownfieldViewerClient />);
    assert.ok(screen.getByText(/workbook not found/i));
    assert.equal(screen.queryByText("Greenfield app"), null);
  });

  it("does not render an unknown id as a workbook", () => {
    state.project = "nope";
    render(<BrownfieldViewerClient />);
    assert.ok(screen.getByText(/workbook not found/i));
  });
});
