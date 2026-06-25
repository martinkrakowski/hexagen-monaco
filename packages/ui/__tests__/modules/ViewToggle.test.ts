import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ViewToggle } from "../../src/modules/ViewToggle.js";

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
    const ref = React.createRef<HTMLDivElement>();
    render(React.createElement(ViewToggle, { ...defaultProps, ref }));
    assert.ok(ref.current instanceof HTMLDivElement);
  });

  it("renders custom icons when iconA and iconB are provided", () => {
    const { container } = render(
      React.createElement(ViewToggle, {
        ...defaultProps,
        iconA: React.createElement("span", { "data-testid": "custom-a" }, "A"),
        iconB: React.createElement("span", { "data-testid": "custom-b" }, "B"),
      }),
    );
    assert.ok(container.querySelector('[data-testid="custom-a"]'));
    assert.ok(container.querySelector('[data-testid="custom-b"]'));
  });
});
