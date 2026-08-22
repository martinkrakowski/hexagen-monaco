import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { RepoEntryView } from "./RepoEntryView";

/**
 * S2a rendering (BF-5.3). jest-dom is not registered in this workspace, so
 * every assertion is `toBeTruthy()` / `getAttribute()` / `toBeNull()`.
 */

function renderView(
  overrides: Partial<Parameters<typeof RepoEntryView>[0]> = {},
) {
  const props = {
    formId: "repo-form",
    repoInput: "",
    refInput: "",
    projectName: "",
    advisory: null,
    frozen: false,
    onRepoInputChange: vi.fn(),
    onRefInputChange: vi.fn(),
    onProjectNameChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  const utils = render(<RepoEntryView {...props} />);
  return { ...utils, props };
}

describe("RepoEntryView", () => {
  it("renders the three fields and raises each change as an intent", () => {
    const { props } = renderView();

    const repo = screen.getByLabelText("Repository");
    fireEvent.change(repo, { target: { value: "acme/checkout" } });
    expect(props.onRepoInputChange).toHaveBeenCalledWith("acme/checkout");

    fireEvent.change(screen.getByLabelText("Branch or tag"), {
      target: { value: "release/2.0" },
    });
    expect(props.onRefInputChange).toHaveBeenCalledWith("release/2.0");

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "checkout" },
    });
    expect(props.onProjectNameChange).toHaveBeenCalledWith("checkout");
  });

  it("carries the form id so a footer button outside the form can own it", () => {
    // The chrome rule puts the primary action in the shell's footer slot. If
    // the form did not expose its id, Enter would do nothing on a three-field
    // form -- which is how most people submit one.
    const { container } = renderView();
    const form = container.querySelector("form");
    expect(form?.getAttribute("id")).toBe("repo-form");
  });

  it("submits on Enter without navigating", () => {
    const { container, props } = renderView({ repoInput: "acme/checkout" });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("wires the advisory to the field it is about, and marks it invalid", () => {
    renderView({
      repoInput: "https://gitlab.com/a/b",
      advisory: "Only github.com repositories can be scanned here.",
    });
    const repo = screen.getByLabelText("Repository");
    expect(repo.getAttribute("aria-invalid")).toBe("true");

    const describedBy = repo.getAttribute("aria-describedby") ?? "";
    const ids = describedBy.split(" ").filter(Boolean);
    const described = ids
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("Only github.com repositories");
  });

  it("has no advisory wiring when there is nothing to say", () => {
    renderView({ repoInput: "acme/checkout" });
    const repo = screen.getByLabelText("Repository");
    expect(repo.getAttribute("aria-invalid")).toBeNull();
  });

  it("states the tier's privacy posture on the screen where the choice is made", () => {
    renderView();
    expect(screen.getByText(/Not for client engagements/)).toBeTruthy();
    expect(screen.getByText(/must be public/)).toBeTruthy();
    // The honesty strip is a standing property of the tier, not an alert -- an
    // alert would announce it as though something had just gone wrong.
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("freezes every field while a run is starting", () => {
    renderView({ frozen: true });
    for (const label of ["Repository", "Branch or tag", "Project name"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(
        true,
      );
    }
  });
});
