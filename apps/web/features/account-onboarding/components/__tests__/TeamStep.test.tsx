import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";

import { TeamStep } from "../TeamStep";

function renderStep(overrides: Partial<Parameters<typeof TeamStep>[0]> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onSkipSetup: vi.fn(),
  };
  render(<TeamStep {...handlers} {...overrides} />);
  return handlers;
}

describe("TeamStep", () => {
  it("Skip is always available — a first team is optional", () => {
    const handlers = renderStep();
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    assert.equal(handlers.onSkip.mock.calls.length, 1);
  });

  it("carries BOTH skips: step-skip to invites AND the wizard-wide Skip setup", () => {
    // Losing "Skip setup" made this the one intermediate screen with no way
    // out of the wizard (review flag on #667). The two actions are distinct:
    // "Skip for now" only skips the team, "Skip setup" completes onboarding.
    const handlers = renderStep();
    assert.ok(screen.getByRole("button", { name: /skip for now/i }));
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    assert.equal(handlers.onSkipSetup.mock.calls.length, 1);
    assert.equal(
      handlers.onSkip.mock.calls.length,
      0,
      "the wizard-wide skip must not fire the step-skip",
    );
  });

  it("Create is disabled until name and slug are valid", () => {
    const handlers = renderStep();
    const create = screen.getByRole("button", { name: /create team/i });
    assert.ok(create.hasAttribute("disabled"));
    fireEvent.click(create);
    assert.equal(handlers.onCreate.mock.calls.length, 0);
  });

  it("auto-suggests the team slug and submits name + slug", () => {
    const handlers = renderStep();
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Platform Crew" },
    });
    assert.equal(
      (screen.getByLabelText(/^slug$/i) as HTMLInputElement).value,
      "platform-crew",
    );
    fireEvent.click(screen.getByRole("button", { name: /create team/i }));
    assert.deepEqual(handlers.onCreate.mock.calls, [
      ["Platform Crew", "platform-crew"],
    ]);
  });

  it("surfaces the parent's validationMessage (duplicate team slug)", () => {
    renderStep({ validationMessage: "That team slug is taken." });
    assert.match(screen.getByRole("alert").textContent ?? "", /taken/i);
  });
});
