import { describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TierPickerView } from "../TierPickerView";
import type { BrownfieldTier } from "../../BrownfieldFlow/types";
import type { GithubScanAvailability } from "../../ScanProgress/useGithubScanAvailability";

// jest-dom is a dependency but apps/web/vitest.setup.ts does not import it, so
// toBeInTheDocument/toHaveAttribute are NOT registered. Assertions here use
// toBeTruthy()/toBeNull()/getAttribute() instead.

function renderPicker(
  overrides: {
    tier?: BrownfieldTier | null;
    onSelectTier?: (tier: BrownfieldTier) => void;
    cloneAvailability?: GithubScanAvailability;
  } = {},
) {
  const onSelectTier = overrides.onSelectTier ?? vi.fn();
  render(
    <TierPickerView
      tier={overrides.tier ?? null}
      onSelectTier={onSelectTier}
      projectName="Acme Checkout"
      // Default to the state most deployments are in: the kill switch is off.
      cloneAvailability={overrides.cloneAvailability ?? "not-enabled"}
    />,
  );
  return { onSelectTier };
}

function cloneRadio(): HTMLInputElement {
  return screen.getByRole("radio", {
    name: /Public repo URL/,
  }) as HTMLInputElement;
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

  it("never claims server-side cloning is unbuilt — BF-5.3 shipped it", () => {
    // The card said "not available yet" long after the screen was mounted and
    // the landing page listed the tier as available. That sentence must not
    // come back in ANY availability state.
    for (const availability of [
      "checking",
      "available",
      "not-enabled",
      "unknown",
    ] as const) {
      cleanup();
      renderPicker({ cloneAvailability: availability });
      expect(document.body.textContent).not.toMatch(/not available yet/i);
    }
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

/**
 * The screen always exists; the endpoint usually does not. Each state below is
 * a different TRUE sentence, which is the whole point — a single fixed string
 * was wrong in at least one of them.
 */
describe("TierPickerView — what the repo-URL tier claims", () => {
  it("asks for a moment while the probe is in flight, and is unpickable", () => {
    renderPicker({ cloneAvailability: "checking" });
    expect(cloneRadio().disabled).toBe(true);
    expect(document.body.textContent).toMatch(
      /Checking whether this deployment runs server-side scanning/,
    );
  });

  it("is pickable, with the retention sentence, once the endpoint answers", async () => {
    const user = userEvent.setup();
    const { onSelectTier } = renderPicker({ cloneAvailability: "available" });
    expect(cloneRadio().disabled).toBe(false);
    expect(document.body.textContent).toMatch(
      /We shallow-clone the repository/,
    );
    await user.click(cloneRadio());
    expect(onSelectTier).toHaveBeenCalledWith("clone");
  });

  it("says the deployment does not run the endpoint when it 404s, and blocks the pick", () => {
    renderPicker({ cloneAvailability: "not-enabled" });
    expect(cloneRadio().disabled).toBe(true);
    // Borrowed verbatim from `describeUnavailable()`, so this card and the scan
    // screen cannot drift into two explanations of one fact.
    expect(document.body.textContent).toMatch(
      /This deployment does not run the GitHub scan endpoint/,
    );
    expect(document.body.textContent).toMatch(/switched off, not broken/);
  });

  it("stays pickable when the probe itself failed, and says why", () => {
    // A failed probe is evidence of nothing. Disabling the card on it would let
    // a proxy that rewrites errors hide a working feature.
    renderPicker({ cloneAvailability: "unknown" });
    expect(cloneRadio().disabled).toBe(false);
    expect(document.body.textContent).toMatch(/could not confirm/i);
    expect(document.body.textContent).toMatch(/nothing is cloned/i);
  });

  it("keeps the client-engagement caution in every state", () => {
    for (const availability of [
      "checking",
      "available",
      "not-enabled",
      "unknown",
    ] as const) {
      cleanup();
      renderPicker({ cloneAvailability: availability });
      expect(screen.getByText("Not for client engagements.")).toBeTruthy();
    }
  });
});
