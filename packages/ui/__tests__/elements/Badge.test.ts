import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Badge } from "../../src/elements/Badge.js";

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

describe("Badge component", () => {
  it("renders a div element with correct text", () => {
    const { getByText } = render(React.createElement(Badge, null, "New"));
    const badge = getByText("New");
    assert.ok(badge instanceof dom.window.HTMLDivElement);
  });

  it("forwards ref to underlying div element", () => {
    const ref = React.createRef();
    render(React.createElement(Badge, { ref }, "Test"));
    assert.ok(ref.current instanceof dom.window.HTMLDivElement);
    assert.strictEqual(ref.current?.textContent, "Test");
  });

  it("applies default variant classes", () => {
    const { getByText } = render(React.createElement(Badge, null, "Default"));
    const badge = getByText("Default");
    assert.match(badge.className, /bg-primary/);
    assert.match(badge.className, /text-primary-foreground/);
  });

  it("applies secondary variant classes", () => {
    const { getByText } = render(
      React.createElement(Badge, { variant: "secondary" }, "Secondary"),
    );
    const badge = getByText("Secondary");
    assert.match(badge.className, /bg-secondary/);
    assert.match(badge.className, /text-secondary-foreground/);
  });

  it("applies destructive variant classes", () => {
    const { getByText } = render(
      React.createElement(Badge, { variant: "destructive" }, "Error"),
    );
    const badge = getByText("Error");
    assert.match(badge.className, /bg-destructive/);
    assert.match(badge.className, /text-destructive-foreground/);
  });

  it("applies outline variant classes", () => {
    const { getByText } = render(
      React.createElement(Badge, { variant: "outline" }, "Outline"),
    );
    const badge = getByText("Outline");
    assert.match(badge.className, /border-border/);
    assert.match(badge.className, /text-foreground/);
  });

  it("merges custom className with variant classes", () => {
    const { getByText } = render(
      React.createElement(Badge, { className: "custom-badge" }, "Custom"),
    );
    const badge = getByText("Custom");
    assert.match(badge.className, /custom-badge/);
    assert.match(badge.className, /bg-primary/);
  });

  it("applies rounded-full class for pill shape", () => {
    const { getByText } = render(React.createElement(Badge, null, "Pill"));
    const badge = getByText("Pill");
    assert.match(badge.className, /rounded-full/);
  });
});
