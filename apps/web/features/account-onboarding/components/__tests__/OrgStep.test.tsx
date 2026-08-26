import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";

import { OrgStep } from "../OrgStep";

function renderStep(overrides: Partial<Parameters<typeof OrgStep>[0]> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
  };
  render(<OrgStep {...handlers} {...overrides} />);
  return handlers;
}

const nameInput = () =>
  screen.getByLabelText(/organization name/i) as HTMLInputElement;
const slugInput = () => screen.getByLabelText(/^slug$/i) as HTMLInputElement;

describe("OrgStep", () => {
  it("auto-suggests the slug from the name", () => {
    renderStep();
    fireEvent.change(nameInput(), { target: { value: "Acme Robotics!" } });
    assert.equal(slugInput().value, "acme-robotics");
  });

  it("stops suggesting once the slug is edited manually", () => {
    renderStep();
    fireEvent.change(nameInput(), { target: { value: "Acme" } });
    fireEvent.change(slugInput(), { target: { value: "my-own-slug" } });
    fireEvent.change(nameInput(), { target: { value: "Acme Robotics" } });
    assert.equal(slugInput().value, "my-own-slug");
  });

  it("re-arms the suggestion when the slug field is cleared", () => {
    renderStep();
    fireEvent.change(nameInput(), { target: { value: "Acme" } });
    fireEvent.change(slugInput(), { target: { value: "custom" } });
    fireEvent.change(slugInput(), { target: { value: "" } });
    fireEvent.change(nameInput(), { target: { value: "Acme Robotics" } });
    assert.equal(slugInput().value, "acme-robotics");
  });

  it("refuses an off-pattern slug locally and disables Create", () => {
    const handlers = renderStep();
    fireEvent.change(nameInput(), { target: { value: "Acme" } });
    fireEvent.change(slugInput(), { target: { value: "-Bad Slug-" } });
    assert.ok(screen.getByRole("alert"));
    const create = screen.getByRole("button", { name: /create organization/i });
    assert.ok(create.hasAttribute("disabled"));
    fireEvent.click(create);
    assert.equal(handlers.onCreate.mock.calls.length, 0);
  });

  it("submits the trimmed name and the slug", () => {
    const handlers = renderStep();
    fireEvent.change(nameInput(), { target: { value: "  Acme Robotics  " } });
    fireEvent.click(
      screen.getByRole("button", { name: /create organization/i }),
    );
    assert.deepEqual(handlers.onCreate.mock.calls, [
      ["Acme Robotics", "acme-robotics"],
    ]);
  });

  it("surfaces the parent's validationMessage (the 409 path)", () => {
    renderStep({ validationMessage: "That slug is taken — pick another." });
    assert.match(
      screen.getByRole("alert").textContent ?? "",
      /taken — pick another/i,
    );
  });
});
