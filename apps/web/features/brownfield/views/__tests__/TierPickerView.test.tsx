import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TierPickerView } from "../TierPickerView";
import type { BrownfieldTier } from "../../BrownfieldFlow/types";

// jest-dom is a dependency but apps/web/vitest.setup.ts does not import it, so
// toBeInTheDocument/toHaveAttribute are NOT registered. Assertions here use
// toBeTruthy()/toBeNull()/getAttribute() instead.

function renderPicker(
  overrides: {
    tier?: BrownfieldTier | null;
    onSelectTier?: (tier: BrownfieldTier) => void;
  } = {},
) {
  const onSelectTier = overrides.onSelectTier ?? vi.fn();
  render(
    <TierPickerView
      tier={overrides.tier ?? null}
      onSelectTier={onSelectTier}
      projectName="Acme Checkout"
    />,
  );
  return { onSelectTier };
}

describe("TierPickerView", () => {
  it("names the group and offers all three privacy tiers", () => {
    renderPicker();
    expect(
      screen.getByRole("radiogroup", { name: "How your codebase is read" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio").length).toBe(3);
  });

  it("carries the carried project name for orientation", () => {
    renderPicker();
    expect(document.body.textContent).toMatch(/Acme Checkout/);
  });

  it("shows the 'leaves your machine' strip as a badge, not as prose", () => {
    // The plan is explicit that this disclosure must not be collapsed into the
    // description. Asserting the literal strip keeps a future edit from quietly
    // folding it into the surrounding sentence.
    renderPicker();
    expect(
      screen.getByText("manifest · layout · baseline · report · ledger"),
    ).toBeTruthy();
  });

  it("renders the repo-URL tier as genuinely unpickable, with the reason", () => {
    renderPicker();
    const clone = screen.getByRole("radio", {
      name: /Public repo URL/,
    }) as HTMLInputElement;
    expect(clone.disabled).toBe(true);
    expect(document.body.textContent).toMatch(
      /Server-side cloning is not available yet/,
    );
  });

  it("keeps the client-engagement caution on the repo-URL tier", () => {
    renderPicker();
    expect(screen.getByText("Not for client engagements.")).toBeTruthy();
  });

  it("raises the picked tier and owns no selection state of its own", async () => {
    const user = userEvent.setup();
    const { onSelectTier } = renderPicker();
    await user.click(screen.getByRole("radio", { name: /Upload a zip/ }));
    expect(onSelectTier).toHaveBeenCalledWith("zip");

    // Nothing became checked: the component is controlled, and `tier` is still
    // null. A view that checked itself would drift from the flow state.
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked.length).toBe(0);
  });

  it("reflects the controlled selection", () => {
    renderPicker({ tier: "artifacts" });
    const artifacts = screen.getByRole("radio", {
      name: /Artifacts only/,
    }) as HTMLInputElement;
    expect(artifacts.checked).toBe(true);
  });
});
