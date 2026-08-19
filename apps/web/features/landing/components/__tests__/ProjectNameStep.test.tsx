import React from "react";
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectNameStep } from "../ProjectNameStep";
import { MAX_PROJECT_NAME_CHARS } from "@/lib/project-scan/limits";

describe("ProjectNameStep", () => {
  it("does not submit an over-long name and shows an inline error", async () => {
    const onSubmit = vi.fn();
    render(
      <ProjectNameStep
        defaultValue={"x".repeat(MAX_PROJECT_NAME_CHARS + 1)}
        onSubmit={onSubmit}
        onBack={() => {}}
      />,
    );

    const continueButton = screen.getByRole("button", { name: /continue/i });
    assert.equal((continueButton as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByRole("alert"));
    assert.match(
      screen.getByRole("alert").textContent || "",
      new RegExp(`exceeds ${MAX_PROJECT_NAME_CHARS}`),
    );

    await userEvent.click(continueButton);
    assert.equal(onSubmit.mock.calls.length, 0);
  });

  it("caps the input at MAX_PROJECT_NAME_CHARS and submits a valid name", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ProjectNameStep onSubmit={onSubmit} onBack={() => {}} />);

    const input = screen.getByLabelText(/project name/i) as HTMLInputElement;
    assert.equal(input.maxLength, MAX_PROJECT_NAME_CHARS);

    await user.type(input, "Demo");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    assert.deepEqual(onSubmit.mock.calls, [["Demo"]]);
  });
});
