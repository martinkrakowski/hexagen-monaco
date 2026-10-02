import React from "react";
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  path: "brownfield" as string | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => ({
    get: (k: string) => (k === "path" ? nav.path : null),
  }),
}));

const saved = vi.hoisted(() => ({ saveProject: vi.fn() }));
vi.mock("@/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({ saveProject: saved.saveProject }),
}));

import { NameStepClient } from "./NameStepClient";

describe("NameStepClient — brownfield workbook entry", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    saved.saveProject.mockReset().mockResolvedValue("proj-1");
    nav.path = "brownfield";
  });

  it("saves a project with mode brownfield and routes to the viewer, never the workspace", async () => {
    const user = userEvent.setup();
    render(<NameStepClient />);

    await user.type(
      screen.getByLabelText(/project name/i),
      "Client engagement",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    assert.equal(saved.saveProject.mock.calls.length, 1);
    const args = saved.saveProject.mock.calls[0];
    assert.equal(args[0], "Client engagement");
    assert.equal(args[4], "brownfield");
    assert.deepEqual(nav.push.mock.calls, [
      ["/projects/brownfield?project=proj-1"],
    ]);
  });

  it("does not navigate when persistence fails", async () => {
    saved.saveProject.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<NameStepClient />);

    await user.type(screen.getByLabelText(/project name/i), "X");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    assert.equal(nav.push.mock.calls.length, 0);
  });

  it("leaves the blank path greenfield: no mode argument", async () => {
    nav.path = "blank";
    const user = userEvent.setup();
    render(<NameStepClient />);

    await user.type(screen.getByLabelText(/project name/i), "Plain");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    assert.equal(saved.saveProject.mock.calls[0][4], undefined);
    assert.equal(nav.push.mock.calls[0][0], "/wizard/1?project=proj-1");
  });
});
