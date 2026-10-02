import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
  clear: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k === "project" ? state.project : null),
  }),
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({ clearActiveWorkspace: state.clear }),
}));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({
    projects: state.projects,
    isLoading: state.isLoading,
  }),
}));

import { buildBundle } from "@/brownfield-workbook/__tests__/bundle-fixtures";
import { BrownfieldViewerClient } from "./BrownfieldViewerClient";

describe("brownfield viewer page", () => {
  beforeEach(() => {
    forbidden.hit.length = 0;
    state.clear.mockReset();
    state.project = "wb-1";
    state.isLoading = false;
    state.projects = [
      { id: "wb-1", name: "Client engagement", mode: "brownfield" },
      { id: "gf-1", name: "Greenfield app" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch must not be called");
      }),
    );
  });

  it("shows the workbook name and the intake, with no step until a bundle is open", () => {
    render(<BrownfieldViewerClient />);
    assert.ok(screen.getByText("Client engagement"));
    assert.ok(screen.getByLabelText(/open a workbook bundle/i));
    assert.equal(screen.queryByTestId("step-observe"), null);
  });

  it("reads a chosen bundle in the browser: six steps appear, and no request is made", async () => {
    vi.stubGlobal("XMLHttpRequest", function () {
      throw new Error("XHR must not be used");
    });
    render(<BrownfieldViewerClient />);
    const zip = await buildBundle();
    const file = new File([zip as BlobPart], "engagement.zip");
    // jsdom's File has no arrayBuffer(); browsers do.
    Object.defineProperty(file, "arrayBuffer", {
      value: async () =>
        zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
    });
    fireEvent.change(screen.getByLabelText(/open a workbook bundle/i), {
      target: { files: [file] },
    });
    await waitFor(() => assert.ok(screen.getByTestId("step-evidence")));
    for (const id of ["checkout", "observe", "slice", "contract", "grant"]) {
      assert.ok(screen.getByTestId("step-" + id), id);
    }
    assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    assert.deepEqual(forbidden.hit, []);
  });

  it("refuses a file that is not a bundle, with a message", async () => {
    const notZip = new File(["not a zip"], "x.zip");
    Object.defineProperty(notZip, "arrayBuffer", {
      value: async () => new TextEncoder().encode("not a zip").buffer,
    });
    render(<BrownfieldViewerClient />);
    fireEvent.change(screen.getByLabelText(/open a workbook bundle/i), {
      target: { files: [notZip] },
    });
    await waitFor(() => assert.ok(screen.getByRole("alert")));
    assert.equal(screen.queryByTestId("step-observe"), null);
  });

  it("mounts none of GovernancePanelWrapper, useEditorPush, the generate flow, and calls no route", () => {
    render(<BrownfieldViewerClient />);
    assert.deepEqual(forbidden.hit, []);
    assert.equal(vi.mocked(fetch).mock.calls.length, 0);
  });

  it("clears the active workspace on mount, so the shared chrome has no target", () => {
    render(<BrownfieldViewerClient />);
    assert.ok(state.clear.mock.calls.length >= 1);
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

  it("refuses an oversized file before reading it into memory", async () => {
    render(<BrownfieldViewerClient />);
    const big = new File(["x"], "huge.zip");
    Object.defineProperty(big, "size", { value: 300 * 1024 * 1024 });
    const read = vi.fn();
    Object.defineProperty(big, "arrayBuffer", { value: read });
    fireEvent.change(screen.getByLabelText(/open a workbook bundle/i), {
      target: { files: [big] },
    });
    await waitFor(() => assert.ok(screen.getByRole("alert")));
    assert.match(screen.getByRole("alert").textContent ?? "", /too large/i);
    assert.equal(read.mock.calls.length, 0);
  });

  it("a slower first read cannot overwrite the second file's state", async () => {
    render(<BrownfieldViewerClient />);
    const good = await buildBundle();
    const slow = new File(["x"], "slow.zip");
    let release!: () => void;
    Object.defineProperty(slow, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = () => resolve(new TextEncoder().encode("not a zip").buffer);
        }),
    });
    const fast = new File(["x"], "fast.zip");
    Object.defineProperty(fast, "arrayBuffer", {
      value: async () =>
        good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength),
    });
    const input = screen.getByLabelText(/open a workbook bundle/i);
    fireEvent.change(input, { target: { files: [slow] } });
    fireEvent.change(input, { target: { files: [fast] } });
    await waitFor(() => assert.ok(screen.getByTestId("step-evidence")));
    release();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(screen.getByTestId("step-evidence"), "still the second file");
    assert.equal(screen.queryByRole("alert"), null);
  });
});
