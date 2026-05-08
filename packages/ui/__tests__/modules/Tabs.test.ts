import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Tabs } from "../../src/modules/Tabs.js";

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

describe("Tabs compound component", () => {
  const createTabs = (props = {}) => {
    return render(
      React.createElement(
        Tabs.Root,
        { defaultTab: "tab1", ...props },
        React.createElement(
          Tabs.List,
          null,
          React.createElement(Tabs.Trigger, { value: "tab1" }, "Tab 1"),
          React.createElement(Tabs.Trigger, { value: "tab2" }, "Tab 2"),
        ),
        React.createElement(Tabs.Content, { value: "tab1" }, "Content 1"),
        React.createElement(Tabs.Content, { value: "tab2" }, "Content 2"),
      ),
    );
  };

  it("renders tab list and triggers", () => {
    const { getByRole } = createTabs();
    assert.ok(getByRole("tablist"));
    assert.ok(getByRole("tab", { name: "Tab 1" }));
    assert.ok(getByRole("tab", { name: "Tab 2" }));
  });

  it("renders initial active tab content", () => {
    const { getByRole, queryByRole } = createTabs();
    assert.ok(getByRole("tabpanel", { name: "Tab 1" }));
    assert.strictEqual(queryByRole("tabpanel", { name: "Tab 2" }), null);
  });

  it("switches tab on trigger click", () => {
    const { getByRole, queryByRole } = createTabs();
    const tab2 = getByRole("tab", { name: "Tab 2" });
    fireEvent.click(tab2);
    assert.ok(getByRole("tabpanel", { name: "Tab 2" }));
    assert.strictEqual(queryByRole("tabpanel", { name: "Tab 1" }), null);
  });

  it("sets correct aria-selected on triggers", () => {
    const { getByRole } = createTabs();
    const tab1 = getByRole("tab", { name: "Tab 1" });
    const tab2 = getByRole("tab", { name: "Tab 2" });
    assert.strictEqual(tab1.getAttribute("aria-selected"), "true");
    assert.strictEqual(tab2.getAttribute("aria-selected"), "false");
  });

  it("handles keyboard navigation (ArrowRight)", () => {
    const { getByRole } = createTabs();
    const tab1 = getByRole("tab", { name: "Tab 1" });
    fireEvent.keyDown(tab1, { key: "ArrowRight" });
    const tab2 = getByRole("tab", { name: "Tab 2" });
    assert.strictEqual(tab2.getAttribute("aria-selected"), "true");
  });

  it("applies active styles to active trigger", () => {
    const { getByRole } = createTabs();
    const tab1 = getByRole("tab", { name: "Tab 1" });
    assert.match(tab1.className, /text-primary/);
    assert.match(tab1.className, /border-b-2/);
  });

  it("forwards value/onValueChange for controlled mode", () => {
    let changedValue = "";
    const { getByRole } = render(
      React.createElement(
        Tabs.Root,
        {
          value: "tab2",
          onValueChange: (val) => {
            changedValue = val;
          },
        },
        React.createElement(
          Tabs.List,
          null,
          React.createElement(Tabs.Trigger, { value: "tab1" }, "Tab 1"),
          React.createElement(Tabs.Trigger, { value: "tab2" }, "Tab 2"),
        ),
        React.createElement(Tabs.Content, { value: "tab1" }, "Content 1"),
        React.createElement(Tabs.Content, { value: "tab2" }, "Content 2"),
      ),
    );
    const tab1 = getByRole("tab", { name: "Tab 1" });
    fireEvent.click(tab1);
    assert.strictEqual(changedValue, "tab1");
  });
});
