import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";

import { WorkspaceStep } from "../WorkspaceStep";

function renderStep(
  overrides: Partial<Parameters<typeof WorkspaceStep>[0]> = {},
) {
  const handlers = {
    onJustMe: vi.fn(),
    onCreateOrg: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
  };
  render(<WorkspaceStep {...handlers} {...overrides} />);
  return handlers;
}

describe("WorkspaceStep", () => {
  it("offers exactly the two workspace choices", () => {
    renderStep();
    assert.ok(screen.getByRole("button", { name: /just me/i }));
    assert.ok(screen.getByRole("button", { name: /create an organization/i }));
  });

  it("routes each choice to its own callback", () => {
    const handlers = renderStep();
    fireEvent.click(screen.getByRole("button", { name: /just me/i }));
    assert.equal(handlers.onJustMe.mock.calls.length, 1);
    assert.equal(handlers.onCreateOrg.mock.calls.length, 0);

    fireEvent.click(
      screen.getByRole("button", { name: /create an organization/i }),
    );
    assert.equal(handlers.onCreateOrg.mock.calls.length, 1);
  });

  it("Back and Skip setup raise their callbacks", () => {
    const handlers = renderStep();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    assert.equal(handlers.onBack.mock.calls.length, 1);
    assert.equal(handlers.onSkip.mock.calls.length, 1);
  });

  it("busy disables both choices", () => {
    const handlers = renderStep({ busy: true });
    const justMe = screen.getByRole("button", { name: /just me/i });
    assert.ok(justMe.hasAttribute("disabled"));
    fireEvent.click(justMe);
    assert.equal(handlers.onJustMe.mock.calls.length, 0);
  });
});
