import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Tabs, type TabsRootProps } from "../../src/modules/Tabs.js";

afterEach(() => {
  cleanup();
});

describe("Tabs compound component", () => {
  const tabsChildren = [
    React.createElement(Tabs.List, {
      key: "list",
      children: [
        React.createElement(Tabs.Trigger, {
          key: "tab1",
          value: "tab1",
          children: "Tab 1",
        }),
        React.createElement(Tabs.Trigger, {
          key: "tab2",
          value: "tab2",
          children: "Tab 2",
        }),
      ],
    }),
    React.createElement(Tabs.Content, {
      key: "content-tab1",
      value: "tab1",
      children: "Content 1",
    }),
    React.createElement(Tabs.Content, {
      key: "content-tab2",
      value: "tab2",
      children: "Content 2",
    }),
  ];

  const createTabs = (props: Omit<TabsRootProps, "children"> = {}) => {
    return render(
      React.createElement(Tabs.Root, {
        defaultTab: "tab1",
        ...props,
        children: tabsChildren,
      }),
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
      React.createElement(Tabs.Root, {
        value: "tab2",
        onValueChange: (val) => {
          changedValue = val;
        },
        children: tabsChildren,
      }),
    );
    const tab1 = getByRole("tab", { name: "Tab 1" });
    fireEvent.click(tab1);
    assert.strictEqual(changedValue, "tab1");
  });
});
