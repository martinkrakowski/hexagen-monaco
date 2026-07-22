import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";

// DerivedFromPlanLink self-subscribes to the wizard lifecycle context (so the
// memo'd workspace layout never gains a new prop) — mock the hook, same idiom
// as PlanPhaseView.test.tsx.
const lifecycle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../../contexts/WizardLifecycleContext", () => ({
  useWizardLifecycleContext: () => lifecycle.current,
}));

import { DerivedFromPlanLink } from "../DerivedFromPlanLink";

function project(layers: unknown[]) {
  return {
    id: "p1",
    name: "Vellum",
    schemaVersion: 4,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
    layers,
  };
}

const layer = (overrides: Record<string, unknown> = {}) => ({
  id: "L1",
  kind: "brainstorm",
  title: "Initial brainstorm",
  createdAt: 1,
  updatedAt: 1,
  turns: [],
  ...overrides,
});

describe("DerivedFromPlanLink", () => {
  beforeEach(() => {
    cleanup();
    lifecycle.current = { loadedProject: null };
  });

  it("renders nothing when no loaded project exists", () => {
    const { container } = render(
      <DerivedFromPlanLink onNavigateToPlan={vi.fn()} />,
    );
    assert.strictEqual(container.firstChild, null);
  });

  it("renders nothing when no layer carries a produced-manifest link", () => {
    lifecycle.current = {
      loadedProject: project([layer(), layer({ id: "L2", createdAt: 2 })]),
    };
    const { container } = render(
      <DerivedFromPlanLink onNavigateToPlan={vi.fn()} />,
    );
    assert.strictEqual(container.firstChild, null);
  });

  it("renders the affordance (both breakpoint labels) when a layer has the link", () => {
    lifecycle.current = {
      loadedProject: project([
        layer({ link: { type: "produced-manifest", at: 42 } }),
      ]),
    };
    render(<DerivedFromPlanLink onNavigateToPlan={vi.fn()} />);
    const text = (document.body.textContent || "").replace(/\s+/g, " ");
    assert.match(text, /Derived from your planning session/, "desktop label");
    assert.match(text, /From plan/, "mobile label");
  });

  it("navigates to the plan phase on click only — never on mount", () => {
    lifecycle.current = {
      loadedProject: project([
        layer({ link: { type: "produced-manifest", at: 42 } }),
      ]),
    };
    const onNavigateToPlan = vi.fn();
    render(<DerivedFromPlanLink onNavigateToPlan={onNavigateToPlan} />);
    assert.strictEqual(
      onNavigateToPlan.mock.calls.length,
      0,
      "no auto-navigation on render",
    );
    fireEvent.click(document.querySelector("button") as HTMLButtonElement);
    assert.strictEqual(onNavigateToPlan.mock.calls.length, 1);
  });
});
