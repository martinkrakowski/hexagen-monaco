import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";

import { WelcomeStep } from "../WelcomeStep";

describe("WelcomeStep", () => {
  it("greets by name and marks step 1 current in the stepper", () => {
    render(
      <WelcomeStep displayName="Ada" onContinue={() => {}} onSkip={() => {}} />,
    );
    assert.ok(screen.getByRole("heading", { name: /welcome, ada/i }));
    const current = document.querySelector('[aria-current="step"]');
    assert.ok(current, "stepper must mark a current step");
    assert.match(current.textContent ?? "", /welcome/i);
  });

  it("greets generically when the session carries no name", () => {
    render(<WelcomeStep onContinue={() => {}} onSkip={() => {}} />);
    assert.ok(screen.getByRole("heading", { name: /^welcome$/i }));
  });

  it("Continue and Skip setup raise their callbacks", () => {
    const onContinue = vi.fn();
    const onSkip = vi.fn();
    render(<WelcomeStep onContinue={onContinue} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    assert.equal(onContinue.mock.calls.length, 1);
    assert.equal(onSkip.mock.calls.length, 1);
  });
});
