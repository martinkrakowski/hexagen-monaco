import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StageProgressList } from "../StageProgressList";

// StageProgressList is an EXTRACTION of ThinkingBlock's stage row, so its
// contract is whatever that row already did: one indicator per stage, a
// duration badge on complete stages, and a connector between them. It
// deliberately does NOT render `label` as visible text -- the source renders
// only the dot there and names the current stage separately below the row.
// Asserting on visible label text would be asserting a behaviour change.
// `label` surfaces as the row's accessible name instead.
//
// Assertions use toBeTruthy()/getAttribute() rather than jest-dom matchers:
// @testing-library/jest-dom is a dependency but apps/web/vitest.setup.ts does
// not import it, so toBeInTheDocument/toHaveAttribute are not registered.
describe("StageProgressList", () => {
  const mockStages = [
    {
      id: "stage-1",
      label: "Clone",
      status: "complete" as const,
      duration: "1.9s",
    },
    {
      id: "stage-2",
      label: "Detect workspaces",
      status: "complete" as const,
      duration: "0.3s",
    },
    { id: "stage-3", label: "Lint", status: "active" as const },
    { id: "stage-4", label: "Report", status: "pending" as const },
  ];

  it("renders one row per stage", () => {
    const { container } = render(<StageProgressList stages={mockStages} />);
    expect(container.querySelectorAll("[data-stage-status]")).toHaveLength(
      mockStages.length,
    );
  });

  it("exposes each stage's label as its accessible name", () => {
    render(<StageProgressList stages={mockStages} />);
    // Without this the row is a sequence of anonymous dots to a screen reader.
    expect(screen.getByLabelText("Clone: complete")).toBeTruthy();
    expect(screen.getByLabelText("Detect workspaces: complete")).toBeTruthy();
    expect(screen.getByLabelText("Lint: active")).toBeTruthy();
    expect(screen.getByLabelText("Report: pending")).toBeTruthy();
  });

  it("marks each stage with its status", () => {
    render(<StageProgressList stages={mockStages} />);
    expect(
      screen
        .getByLabelText("Clone: complete")
        .getAttribute("data-stage-status"),
    ).toBe("complete");
    expect(
      screen.getByLabelText("Lint: active").getAttribute("data-stage-status"),
    ).toBe("active");
    expect(
      screen
        .getByLabelText("Report: pending")
        .getAttribute("data-stage-status"),
    ).toBe("pending");
  });

  it("renders a duration badge only for complete stages that have one", () => {
    render(<StageProgressList stages={mockStages} />);
    expect(screen.getByText("1.9s")).toBeTruthy();
    expect(screen.getByText("0.3s")).toBeTruthy();
    // The active stage has no duration yet, so nothing should be rendered for it.
    expect(screen.queryByText("undefined")).toBeNull();
  });
});
