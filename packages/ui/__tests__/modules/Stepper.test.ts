import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Stepper } from "../../src/modules/Stepper.js";

afterEach(() => {
  cleanup();
});

const STEPS = [
  { label: "Method", step: 1 },
  { label: "Configure", step: 2 },
  { label: "Generate", step: 3 },
] as const;

describe("Stepper component", () => {
  it("renders an ordered list with one item per step", () => {
    const { container } = render(
      React.createElement(Stepper, { steps: STEPS, currentStep: 1 }),
    );
    const list = container.querySelector("ol");
    assert.ok(list instanceof HTMLOListElement);
    assert.equal(list.querySelectorAll("li").length, 3);
  });

  it("labels the list with the default aria-label", () => {
    const { getByRole } = render(
      React.createElement(Stepper, { steps: STEPS, currentStep: 1 }),
    );
    const list = getByRole("list", { name: "Progress" });
    assert.ok(list instanceof HTMLOListElement);
  });

  it("accepts a custom ariaLabel", () => {
    const { getByRole } = render(
      React.createElement(Stepper, {
        steps: STEPS,
        currentStep: 1,
        ariaLabel: "Onboarding progress",
      }),
    );
    const list = getByRole("list", { name: "Onboarding progress" });
    assert.ok(list instanceof HTMLOListElement);
  });

  it("puts aria-current='step' on the current item only", () => {
    const { container } = render(
      React.createElement(Stepper, { steps: STEPS, currentStep: 2 }),
    );
    const items = Array.from(container.querySelectorAll("li"));
    assert.equal(items[0]?.getAttribute("aria-current"), null);
    assert.equal(items[1]?.getAttribute("aria-current"), "step");
    assert.equal(items[2]?.getAttribute("aria-current"), null);
    assert.match(items[1]?.textContent ?? "", /Configure/);
  });

  it("renders step labels", () => {
    const { getByText } = render(
      React.createElement(Stepper, { steps: STEPS, currentStep: 1 }),
    );
    assert.ok(getByText("Method"));
    assert.ok(getByText("Configure"));
    assert.ok(getByText("Generate"));
  });

  it("styles completed, current and upcoming steps distinctly", () => {
    const { container } = render(
      React.createElement(Stepper, { steps: STEPS, currentStep: 2 }),
    );
    const items = Array.from(container.querySelectorAll("li"));
    const dotOf = (li: Element | undefined) =>
      li?.querySelector("div.rounded-full")?.className ?? "";
    // Completed: solid primary, no ring.
    assert.match(dotOf(items[0]), /bg-primary/);
    assert.doesNotMatch(dotOf(items[0]), /ring-2/);
    // Current: primary with ring.
    assert.match(dotOf(items[1]), /bg-primary/);
    assert.match(dotOf(items[1]), /ring-2/);
    // Upcoming: muted.
    assert.match(dotOf(items[2]), /bg-muted/);
  });
});
