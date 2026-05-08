import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ViewToggle } from "../../src/modules/ViewToggle.js";

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

describe("ViewToggle component", () => {
  const defaultProps = {
    view: "visual",
    options: ["visual", "code"] as [string, string],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onChange: (_view: string) => {},
    ariaLabel: "Toggle view",
  };

  it("renders toggle container", () => {
    const { container } = render(React.createElement(ViewToggle, defaultProps));
    const toggle = container.querySelector("div");
    assert.ok(toggle);
  });

  it("renders Eye icon for visual view", () => {
    const { container } = render(React.createElement(ViewToggle, defaultProps));
    const eyeIcon = container.querySelector("svg"); // Lucide Eye is an SVG
    assert.ok(eyeIcon);
  });

  it("toggles view on checkbox change", () => {
    let currentView = "visual";
    const handleChange = (view: string) => {
      currentView = view;
    };
    const { container } = render(
      React.createElement(ViewToggle, {
        ...defaultProps,
        view: currentView,
        onChange: handleChange,
      }),
    );
    const checkbox = container.querySelector('input[type="checkbox"]');
    assert.ok(checkbox);
    fireEvent.click(checkbox);
    assert.strictEqual(currentView, "code");
  });

  it("applies correct aria-label", () => {
    const { container } = render(React.createElement(ViewToggle, defaultProps));
    const checkbox = container.querySelector('input[type="checkbox"]');
    assert.strictEqual(checkbox?.getAttribute("aria-label"), "Toggle view");
  });

  it("shows Code icon when view is code", () => {
    const { container } = render(
      React.createElement(ViewToggle, {
        ...defaultProps,
        view: "code",
      }),
    );
    const codeIcon = container.querySelectorAll("svg");
    assert.ok(codeIcon.length >= 1);
  });

  it("forwards ref", () => {
    const ref = React.createRef();
    render(React.createElement(ViewToggle, { ...defaultProps, ref }));
    assert.ok(ref.current instanceof dom.window.HTMLDivElement);
  });
});
