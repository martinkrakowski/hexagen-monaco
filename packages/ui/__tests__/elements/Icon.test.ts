import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Icon } from "../../src/elements/Icon.js";

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

describe("Icon component", () => {
  it("renders svg element", () => {
    const { container } = render(React.createElement(Icon, { name: "check" }));
    const svg = container.querySelector("svg");
    assert.ok(svg instanceof dom.window.SVGSVGElement);
  });

  it("forwards ref to underlying svg element", () => {
    const ref = React.createRef<SVGSVGElement>();
    render(React.createElement(Icon, { name: "check", ref }));
    assert.ok(ref.current instanceof dom.window.SVGSVGElement);
  });

  it("applies correct viewBox", () => {
    const { container } = render(React.createElement(Icon, { name: "check" }));
    const svg = container.querySelector("svg");
    assert.strictEqual(svg?.getAttribute("viewBox"), "0 0 24 24");
  });

  it("renders path element with correct d attribute", () => {
    const { container } = render(React.createElement(Icon, { name: "check" }));
    const path = container.querySelector("path");
    assert.ok(path);
    assert.ok(path?.getAttribute("d"));
  });

  it("applies default size (24)", () => {
    const { container } = render(React.createElement(Icon, { name: "check" }));
    const svg = container.querySelector("svg");
    assert.strictEqual(svg?.getAttribute("width"), "24");
    assert.strictEqual(svg?.getAttribute("height"), "24");
  });

  it("applies custom size", () => {
    const { container } = render(
      React.createElement(Icon, { name: "x", size: 32 }),
    );
    const svg = container.querySelector("svg");
    assert.strictEqual(svg?.getAttribute("width"), "32");
    assert.strictEqual(svg?.getAttribute("height"), "32");
  });

  it("renders different icons with different paths", () => {
    const { container: container1 } = render(
      React.createElement(Icon, { name: "check" }),
    );
    const path1 = container1.querySelector("path");
    const d1 = path1?.getAttribute("d");

    cleanup();

    const { container: container2 } = render(
      React.createElement(Icon, { name: "x" }),
    );
    const path2 = container2.querySelector("path");
    const d2 = path2?.getAttribute("d");

    assert.notStrictEqual(d1, d2);
  });

  it("merges custom className", () => {
    const { container } = render(
      React.createElement(Icon, { name: "check", className: "custom-icon" }),
    );
    const svg = container.querySelector("svg");
    assert.ok(svg?.getAttribute("class")?.includes("custom-icon"));
  });

  it("returns null for invalid icon name", () => {
    // @ts-expect-error - testing invalid name
    const { container } = render(
      React.createElement(Icon, { name: "invalid-icon" }),
    );
    const svg = container.querySelector("svg");
    assert.strictEqual(svg, null);
  });
});
