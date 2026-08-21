import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChoiceCardGroup } from "../ChoiceCardGroup";
import type { ChoiceCardGroupProps } from "../ChoiceCardGroup";
import type { ChoiceCardOption } from "../ChoiceCardGroup";

// Assertions use toBeTruthy()/getAttribute() rather than jest-dom matchers:
// @testing-library/jest-dom is a dependency but apps/web/vitest.setup.ts does
// not import it, so toBeInTheDocument/toHaveAttribute are NOT registered.
//
// The fixture mirrors the brownfield S1 privacy-tier picker: three cards, one
// carrying a badge strip, one unavailable with a warning line. The middle card
// is the unavailable one on purpose — an unavailable card at the END would let
// a broken arrow-key walk pass by running off the list instead of stepping over
// a hole in the middle of it.
const TIERS: ChoiceCardOption[] = [
  {
    value: "local",
    label: "Local only",
    description: "Runs entirely on this machine.",
    badge: "nothing leaves your machine",
  },
  {
    value: "hosted",
    label: "Hosted",
    description: "Uploads the repository to the hosted service.",
    disabled: true,
    unavailableReason: "Connect an account first.",
    warning: "Not for client engagements.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Runs locally and syncs a summary.",
  },
];

function renderGroup(
  overrides: {
    value?: string | null;
    onSelect?: (next: string) => void;
    options?: ChoiceCardGroupProps["options"];
  } = {},
) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const { container } = render(
    <ChoiceCardGroup
      label="Privacy tier"
      description="Pick where the scan runs."
      options={overrides.options ?? TIERS}
      value={overrides.value ?? null}
      onSelect={onSelect}
    />,
  );
  return { onSelect, container };
}

describe("ChoiceCardGroup", () => {
  it("renders one radio per option", () => {
    renderGroup();
    expect(screen.getAllByRole("radio")).toHaveLength(TIERS.length);
  });

  it("exposes a named radiogroup", () => {
    renderGroup();
    // Without the accessible name the group is an anonymous pile of radios.
    expect(screen.getByRole("radiogroup", { name: "Privacy tier" })).toBeTruthy();
  });

  it("marks the picked option as checked", () => {
    renderGroup({ value: "hybrid" });
    const checked = screen.getAllByRole("radio", { checked: true });
    expect(checked).toHaveLength(1);
    expect((checked[0] as HTMLInputElement).value).toBe("hybrid");
  });

  it("raises the pick when an option is chosen", () => {
    const { onSelect } = renderGroup();
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(onSelect).toHaveBeenCalledWith("hybrid");
  });

  it("keeps an unavailable option genuinely unselectable", () => {
    const { onSelect } = renderGroup();
    const unavailable = screen.getAllByRole("radio")[1] as HTMLInputElement;
    // Not merely styled grey — the input itself refuses the pick.
    expect(unavailable.disabled).toBe(true);
    fireEvent.click(unavailable);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("swaps an unavailable option's copy for the reason it cannot be picked", () => {
    renderGroup();
    expect(screen.getByText("Connect an account first.")).toBeTruthy();
    expect(
      screen.queryByText("Uploads the repository to the hosted service."),
    ).toBeNull();
  });

  it("renders the badge strip and the warning line", () => {
    renderGroup();
    expect(screen.getByText("nothing leaves your machine")).toBeTruthy();
    expect(screen.getByText("Not for client engagements.")).toBeTruthy();
  });

  it("puts exactly one option in the tab order, and it is the picked one", () => {
    renderGroup({ value: "hybrid" });
    expect(
      screen.getAllByRole("radio").map((radio) => radio.getAttribute("tabindex")),
    ).toEqual(["-1", "-1", "0"]);
  });

  it("falls back to the first option in the tab order when nothing is picked", () => {
    renderGroup();
    expect(
      screen.getAllByRole("radio").map((radio) => radio.getAttribute("tabindex")),
    ).toEqual(["0", "-1", "-1"]);
  });

  it("moves forward on ArrowDown, stepping over the unavailable option", () => {
    const { onSelect } = renderGroup({ value: "local" });
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("hybrid");
    expect(document.activeElement).toBe(radios[2]);
  });

  it("moves backward on ArrowUp", () => {
    const { onSelect } = renderGroup({ value: "hybrid" });
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[2], { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("local");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("wraps around the ends of the group", () => {
    const { onSelect } = renderGroup({ value: "hybrid" });
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[2], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("local");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("treats ArrowRight and ArrowLeft the same as Down and Up", () => {
    const { onSelect } = renderGroup({ value: "local" });
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("hybrid");
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("hybrid");
  });

  it("ignores keys it does not own", () => {
    const { onSelect } = renderGroup({ value: "local" });
    fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "a" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still shows the controlled value checked when that option became unavailable", () => {
    // A controlled parent passing a non-null value must never render an empty
    // selection. If an option is disabled AFTER the user picked it, the honest
    // rendering is checked-and-disabled, not "nothing selected".
    const { container } = renderGroup({
      value: "scan",
      options: [
        { value: "spec", label: "Spec", description: "d1" },
        {
          value: "scan",
          label: "Scan",
          description: "d2",
          disabled: true,
          unavailableReason: "Temporarily unavailable",
        },
      ],
    });
    const checked = container.querySelector('input[type="radio"]:checked');
    expect(checked).toBeTruthy();
    expect(checked?.getAttribute("value")).toBe("scan");
    expect((checked as HTMLInputElement | null)?.disabled).toBe(true);
  });

  it("does not re-emit onSelect when an arrow key cannot move", () => {
    // One pickable option: the modulo lands back on the same index. Firing
    // onSelect there pushes an identical value at the parent on every press.
    const onSelect = vi.fn();
    const { container } = renderGroup({
      value: "spec",
      onSelect,
      options: [
        { value: "spec", label: "Spec", description: "d1" },
        { value: "scan", label: "Scan", description: "d2", disabled: true },
      ],
    });
    const input = container.querySelector(
      'input[value="spec"]',
    ) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
