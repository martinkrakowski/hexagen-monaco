import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Textarea } from "../../src/elements/Textarea.js";

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

describe("Textarea component", () => {
  it("renders a textarea element", () => {
    const { container } = render(React.createElement(Textarea, null));
    const textarea = container.querySelector("textarea");
    assert.ok(textarea instanceof dom.window.HTMLTextAreaElement);
  });

  it("forwards ref to underlying textarea element", () => {
    const ref = React.createRef();
    render(React.createElement(Textarea, { ref }));
    assert.ok(ref.current instanceof dom.window.HTMLTextAreaElement);
  });

  it("applies default classes", () => {
    const { container } = render(React.createElement(Textarea, null));
    const textarea = container.querySelector("textarea");
    assert.match(textarea.className, /flex/);
    assert.match(textarea.className, /min-h-20/);
    assert.match(textarea.className, /w-full/);
    assert.match(textarea.className, /rounded-md/);
    assert.match(textarea.className, /border-input/);
  });

  it("handles rows prop", () => {
    const { container } = render(React.createElement(Textarea, { rows: 5 }));
    const textarea = container.querySelector("textarea");
    assert.strictEqual(textarea.rows, 5);
  });

  it("handles disabled state", () => {
    const { container } = render(
      React.createElement(Textarea, { disabled: true }),
    );
    const textarea = container.querySelector("textarea");
    assert.strictEqual(textarea.disabled, true);
    assert.match(textarea.className, /disabled:cursor-not-allowed/);
    assert.match(textarea.className, /disabled:opacity-50/);
  });

  it("merges custom className", () => {
    const { container } = render(
      React.createElement(Textarea, { className: "custom-textarea" }),
    );
    const textarea = container.querySelector("textarea");
    assert.match(textarea.className, /custom-textarea/);
    assert.match(textarea.className, /flex/);
  });

  it("forwards placeholder prop", () => {
    const { container } = render(
      React.createElement(Textarea, { placeholder: "Enter text here" }),
    );
    const textarea = container.querySelector("textarea");
    assert.strictEqual(textarea.placeholder, "Enter text here");
  });

  // TODO: Fix onChange event test
  // it("handles onChange event", () => {
  //   let changeCount = 0;
  //   const handleChange = () => {
  //     changeCount++;
  //   };
  //   const { container } = render(
  //     React.createElement(Textarea, { onChange: handleChange })
  //   );
  //   const textarea = container.querySelector("textarea");
  //   fireEvent.input(textarea, { target: { value: "test" } });
  //   assert.strictEqual(changeCount, 1);
  // });
});
