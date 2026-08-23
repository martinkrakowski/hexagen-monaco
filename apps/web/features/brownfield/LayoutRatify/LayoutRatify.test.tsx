import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LayoutRatify } from "./LayoutRatify";
import type { LayoutRatifyProps } from "./LayoutRatify";
import type { DetectedPackageSummary } from "./layout-draft";

// jest-dom is NOT registered by apps/web/vitest.setup.ts — toBeTruthy(),
// toBeNull() and getAttribute() only. React is not imported: the Vitest config
// compiles JSX with the automatic runtime and an unused binding is a
// pre-commit ESLint error.

function detected(): DetectedPackageSummary[] {
  return [
    {
      root: "packages/orders",
      name: "orders",
      layers: { domain: ["src/domain"] },
    },
    {
      root: "packages/billing",
      name: "billing",
      layers: { domain: ["src/core"] },
    },
    { root: "packages/eslint-config", name: "eslint-config", layers: {} },
  ];
}

function renderContainer(overrides: Partial<LayoutRatifyProps> = {}) {
  const handlers = {
    onDraftChange: vi.fn(),
    onRatify: vi.fn(),
    onBack: vi.fn(),
  };
  render(
    <LayoutRatify
      packages={detected()}
      projectName="Acme Checkout"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("LayoutRatify (S3 container)", () => {
  it("renders the detected packages behind the shell's footer actions", () => {
    renderContainer();

    expect(
      screen.getByRole("heading", {
        name: "3 packages found. Confirm the ones that are bounded contexts.",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });

  it("hands the host a projected draft — and never navigates itself", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(handlers.onRatify).toHaveBeenCalledTimes(1);
    const draft = handlers.onRatify.mock.calls[0][0];
    const names = draft.contexts.map(
      (context: { contextName: string }) => context.contextName,
    );
    // eslint-config was detected with no layer directories, so it starts
    // EXCLUDED and must not appear in the ratified draft.
    expect(names).toEqual(["orders", "billing"]);
  });

  it("persists every edit through onDraftChange (the BF-3.4 seam)", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    await user.click(boxes[0]);

    expect(handlers.onDraftChange).toHaveBeenCalled();
  });

  it("raises Back as an intent rather than routing", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onRatify).not.toHaveBeenCalled();
  });

  it("refuses to continue when nothing was detected, and says why", () => {
    renderContainer({ packages: [] });

    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows why a layout could not be read instead of an unexplained empty grid", () => {
    // The failure this guards: an unreadable layout rendering as "no packages
    // found", which is a claim about the user's repository that the screen has
    // no basis to make.
    renderContainer({
      packages: [],
      detectionProblem: "The layout arrived truncated and could not be read.",
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/truncated/);
  });

  it("replays a ratified draft so Back from S4 is non-destructive", () => {
    renderContainer({
      packages: detected(),
      ratifiedDraft: {
        contexts: [
          {
            packageRoot: "packages/orders",
            contextName: "checkout-orders",
            layerDirectories: { domain: ["src/domain"] },
          },
        ],
      },
    });

    const named = screen.getByDisplayValue("checkout-orders");
    expect(named).toBeTruthy();
    // billing was absent from the draft, so its ratified state is "excluded".
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.filter((box) => box.checked).length).toBe(1);
  });
});
