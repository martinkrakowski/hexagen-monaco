import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Checkbox } from "../../src/elements/Checkbox.js";

afterEach(() => {
  cleanup();
});

describe("Checkbox component", () => {
  it("renders checkbox input", () => {
    const { container } = render(React.createElement(Checkbox, {}));
    const input = container.querySelector('input[type="checkbox"]');
    assert.ok(input instanceof HTMLInputElement);
  });

  it("forwards ref to underlying input element", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(React.createElement(Checkbox, { ref }));
    assert.ok(ref.current instanceof HTMLInputElement);
  });

  it("applies checked state", () => {
    const { container } = render(
      React.createElement(Checkbox, { checked: true }),
    );
    const input = container.querySelector('input[type="checkbox"]');
    assert.ok(input instanceof HTMLInputElement);
    assert.strictEqual(input.checked, true);
  });

  it("shows checkmark svg when checked", () => {
    const { container } = render(
      React.createElement(Checkbox, { checked: true }),
    );
    const svg = container.querySelector("svg");
    assert.ok(svg);
  });

  it("hides checkmark svg when not checked", () => {
    const { container } = render(
      React.createElement(Checkbox, { checked: false }),
    );
    const svg = container.querySelector("svg");
    assert.strictEqual(svg, null);
  });

  it("calls onCheckedChange when clicked", () => {
    let checkedValue = false;
    const handleChange = (checked: boolean) => {
      checkedValue = checked;
    };
    const { container } = render(
      React.createElement(Checkbox, { onCheckedChange: handleChange }),
    );
    const input = container.querySelector('input[type="checkbox"]');
    assert.ok(input instanceof HTMLInputElement);
    fireEvent.click(input);
    assert.strictEqual(checkedValue, true);
  });

  it("applies custom className to visual span", () => {
    const { container } = render(
      React.createElement(Checkbox, { className: "custom-checkbox" }),
    );
    const visualSpan = container.querySelector('[data-slot="checkbox-visual"]');
    assert.match(visualSpan?.className ?? "", /custom-checkbox/);
  });

  it("handles disabled state", () => {
    const { container } = render(
      React.createElement(Checkbox, { disabled: true }),
    );
    const input = container.querySelector('input[type="checkbox"]');
    assert.ok(input instanceof HTMLInputElement);
    assert.strictEqual(input.disabled, true);
  });
});
