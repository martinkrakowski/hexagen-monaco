import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Label } from "../../src/elements/Label.js";

afterEach(() => {
  cleanup();
});

describe("Label component", () => {
  it("renders label element", () => {
    const { container } = render(
      React.createElement(Label, null, "Test Label"),
    );
    const label = container.querySelector("label");
    assert.ok(label instanceof HTMLLabelElement);
  });

  it("forwards ref to underlying label element", () => {
    const ref = React.createRef<HTMLLabelElement>();
    render(React.createElement(Label, { ref }, "Label"));
    assert.ok(ref.current instanceof HTMLLabelElement);
  });

  it("renders label text", () => {
    const { container } = render(React.createElement(Label, null, "Username"));
    const label = container.querySelector("label");
    assert.strictEqual(label?.textContent, "Username");
  });

  it("applies styling classes", () => {
    const { container } = render(React.createElement(Label, null));
    const label = container.querySelector("label");
    assert.match(label?.className ?? "", /text-sm/);
    assert.match(label?.className ?? "", /font-medium/);
    assert.match(label?.className ?? "", /leading-none/);
  });

  it("applies peer-disabled classes", () => {
    const { container } = render(React.createElement(Label, null));
    const label = container.querySelector("label");
    assert.match(label?.className ?? "", /peer-disabled:cursor-not-allowed/);
    assert.match(label?.className ?? "", /peer-disabled:opacity-70/);
  });

  it("merges custom className", () => {
    const { container } = render(
      React.createElement(Label, { className: "custom-label" }),
    );
    const label = container.querySelector("label");
    assert.match(label?.className ?? "", /custom-label/);
  });

  it("forwards htmlFor prop", () => {
    const { container } = render(
      React.createElement(Label, { htmlFor: "input-id" }),
    );
    const label = container.querySelector("label");
    assert.strictEqual(label?.getAttribute("for"), "input-id");
  });
});
