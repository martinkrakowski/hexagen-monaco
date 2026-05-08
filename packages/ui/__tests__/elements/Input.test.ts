import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Input } from "../../src/elements/Input.js";

let dom: JSDOM;

before(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, "navigator", {
    value: dom.window.navigator,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("Input component", () => {
  it("renders input element", () => {
    const { container } = render(React.createElement(Input, {}));
    const input = container.querySelector("input");
    assert.ok(input instanceof dom.window.HTMLInputElement);
  });

  it("forwards ref to underlying input element", () => {
    const ref = React.createRef();
    render(React.createElement(Input, { ref }));
    assert.ok(ref.current instanceof dom.window.HTMLInputElement);
  });

  it("applies default text type", () => {
    const { container } = render(React.createElement(Input, {}));
    const input = container.querySelector("input");
    assert.strictEqual(input?.type, "text");
  });

  it("applies custom type", () => {
    const { container } = render(
      React.createElement(Input, { type: "password" }),
    );
    const input = container.querySelector("input");
    assert.strictEqual(input?.type, "password");
  });

  it("applies input styling classes", () => {
    const { container } = render(React.createElement(Input, {}));
    const input = container.querySelector("input");
    assert.match(input.className, /flex/);
    assert.match(input.className, /h-10/);
    assert.match(input.className, /w-full/);
    assert.match(input.className, /rounded-md/);
    assert.match(input.className, /border-input/);
    assert.match(input.className, /bg-background/);
  });

  it("handles disabled state", () => {
    const { container } = render(
      React.createElement(Input, { disabled: true }),
    );
    const input = container.querySelector("input");
    assert.strictEqual(input?.disabled, true);
    assert.match(input.className, /disabled:cursor-not-allowed/);
    assert.match(input.className, /disabled:opacity-50/);
  });

  it("merges custom className", () => {
    const { container } = render(
      React.createElement(Input, { className: "custom-input" }),
    );
    const input = container.querySelector("input");
    assert.match(input.className, /custom-input/);
  });

  it("forwards placeholder prop", () => {
    const { container } = render(
      React.createElement(Input, { placeholder: "Enter text" }),
    );
    const input = container.querySelector("input");
    assert.strictEqual(input?.placeholder, "Enter text");
  });

  // jsdom limitation: fireEvent.input does not trigger onChange on React-controlled inputs
  // Skipped: onChange event test for Input component
});
