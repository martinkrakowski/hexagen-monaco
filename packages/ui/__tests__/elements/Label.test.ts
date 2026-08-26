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

  it("renders an aria-hidden asterisk when required is set", () => {
    const { container } = render(
      React.createElement(Label, { required: true }, "Email"),
    );
    const label = container.querySelector("label");
    // Positive assertion first: the label and its asterisk rendered.
    assert.ok(label instanceof HTMLLabelElement);
    const asterisk = label.querySelector("span");
    assert.ok(asterisk);
    assert.strictEqual(asterisk.textContent, "*");
    assert.strictEqual(asterisk.getAttribute("aria-hidden"), "true");
    // The prop must NOT leak onto the DOM element as an attribute.
    assert.strictEqual(label.hasAttribute("required"), false);
  });

  it("renders no asterisk when required is not set", () => {
    const { container } = render(React.createElement(Label, null, "Email"));
    const label = container.querySelector("label");
    assert.ok(label instanceof HTMLLabelElement);
    assert.strictEqual(label.querySelector("span"), null);
    assert.strictEqual(label.textContent, "Email");
  });
});
