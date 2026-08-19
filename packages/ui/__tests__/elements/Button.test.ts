import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Button } from "../../src/elements/Button.js";

afterEach(() => {
  cleanup();
});

describe("Button component", () => {
  it("renders a button element with correct text", () => {
    const { getByRole } = render(React.createElement(Button, null, "Click me"));
    const button = getByRole("button", { name: "Click me" });
    assert.ok(button instanceof HTMLButtonElement);
  });

  it("forwards ref to underlying button element", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(React.createElement(Button, { ref }, "Test"));
    assert.ok(ref.current instanceof HTMLButtonElement);
    assert.strictEqual(ref.current?.textContent, "Test");
  });

  it("applies default variant classes", () => {
    const { getByRole } = render(React.createElement(Button, null, "Default"));
    const button = getByRole("button");
    assert.match(button.className, /bg-primary/);
    assert.match(button.className, /text-primary-foreground/);
  });

  it("applies destructive variant classes", () => {
    const { getByRole } = render(
      React.createElement(Button, { variant: "destructive" }, "Delete"),
    );
    const button = getByRole("button");
    assert.match(button.className, /bg-destructive/);
    assert.match(button.className, /text-destructive-foreground/);
  });

  it("applies outline variant classes", () => {
    const { getByRole } = render(
      React.createElement(Button, { variant: "outline" }, "Outline"),
    );
    const button = getByRole("button");
    assert.match(button.className, /border-input/);
  });

  it("applies size variants correctly", () => {
    const { rerender, getByRole } = render(
      React.createElement(Button, { size: "sm" }, "Small"),
    );
    let button = getByRole("button");
    assert.match(button.className, /h-9/);

    rerender(React.createElement(Button, { size: "lg" }, "Large"));
    button = getByRole("button");
    assert.match(button.className, /h-11/);

    rerender(React.createElement(Button, { size: "icon" }, "Icon"));
    button = getByRole("button");
    assert.match(button.className, /h-10/);
    assert.match(button.className, /w-10/);
  });

  it("handles disabled state correctly", () => {
    const { getByRole } = render(
      React.createElement(Button, { disabled: true }, "Disabled"),
    );
    const button = getByRole("button");
    assert.ok(button instanceof HTMLButtonElement);
    assert.strictEqual(button.disabled, true);
    assert.match(button.className, /disabled:opacity-50/);
    assert.match(button.className, /disabled:pointer-events-none/);
  });

  it("forwards standard button HTML attributes", () => {
    const handleClick = () => {};
    const { getByRole } = render(
      React.createElement(
        Button,
        {
          type: "submit",
          onClick: handleClick,
        },
        "Submit",
      ),
    );
    const button = getByRole("button", { name: "Submit" });
    assert.ok(button instanceof HTMLButtonElement);
    assert.strictEqual(button.type, "submit");
    assert.ok(button.onclick);
  });

  it("merges custom className with variant classes", () => {
    const { getByRole } = render(
      React.createElement(Button, { className: "custom-class" }, "Custom"),
    );
    const button = getByRole("button");
    assert.match(button.className, /custom-class/);
    assert.match(button.className, /bg-primary/);
  });
});
