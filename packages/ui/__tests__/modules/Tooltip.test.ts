import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Tooltip } from "../../src/modules/Tooltip.js";

afterEach(() => {
  cleanup();
});

describe("Tooltip component", () => {
  it("renders the trigger and hides the tooltip content by default", () => {
    const { getByText, queryByRole } = render(
      React.createElement(Tooltip, { content: "Tip body", children: "3" }),
    );
    assert.ok(getByText("3"));
    assert.strictEqual(queryByRole("tooltip"), null);
  });

  it("shows role=tooltip content on focus and wires aria-describedby", () => {
    const { getByText, getByRole } = render(
      React.createElement(Tooltip, { content: "Tip body", children: "3" }),
    );
    const trigger = getByText("3");
    fireEvent.focus(trigger);
    const tip = getByRole("tooltip");
    assert.match(tip.textContent ?? "", /Tip body/);
    assert.strictEqual(trigger.getAttribute("aria-describedby"), tip.id);
  });

  it("hides on Escape", () => {
    const { getByText, queryByRole } = render(
      React.createElement(Tooltip, { content: "Tip body", children: "3" }),
    );
    const trigger = getByText("3");
    fireEvent.focus(trigger);
    assert.ok(queryByRole("tooltip"));
    fireEvent.keyDown(trigger, { key: "Escape" });
    assert.strictEqual(queryByRole("tooltip"), null);
  });

  it("uses popover tokens for the content surface", () => {
    const { getByText, getByRole } = render(
      React.createElement(Tooltip, { content: "Tip body", children: "3" }),
    );
    fireEvent.mouseEnter(getByText("3"));
    const tip = getByRole("tooltip");
    assert.match(tip.className, /bg-popover/);
    assert.match(tip.className, /text-popover-foreground/);
  });

  it("forwards ref to the wrapper span", () => {
    const ref = React.createRef<HTMLSpanElement>();
    render(React.createElement(Tooltip, { ref, content: "x", children: "y" }));
    assert.ok(ref.current instanceof HTMLSpanElement);
  });
});
