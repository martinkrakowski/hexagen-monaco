import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { Accordion } from "../../src/modules/Accordion.js";

afterEach(() => {
  cleanup();
});

type AccordionRootInit =
  | {
      type?: "single";
      collapsible?: boolean;
      defaultValue?: string;
      value?: string;
      onValueChange?: (value: string) => void;
    }
  | {
      type: "multiple";
      defaultValue?: string[];
      value?: string[];
      onValueChange?: (value: string[]) => void;
    };

function accordionItem(value: string, label: string, content: React.ReactNode) {
  return React.createElement(Accordion.Item, {
    value,
    key: value,
    children: [
      React.createElement(Accordion.Trigger, {
        key: `${value}-trigger`,
        children: label,
      }),
      React.createElement(Accordion.Content, {
        key: `${value}-content`,
        children: content,
      }),
    ],
  });
}

// Build a two- (or three-) item accordion without JSX. Each item is
// [triggerLabel, contentText]; `rootProps` is spread onto <Accordion.Root>.
function makeAccordion(
  rootProps: AccordionRootInit,
  items: Array<[string, string]>,
) {
  const children = items.map(([label, content], i) =>
    accordionItem(`item-${i}`, label, content),
  );
  if (rootProps.type === "multiple") {
    return React.createElement(Accordion.Root, {
      ...rootProps,
      type: "multiple",
      children,
    });
  }
  return React.createElement(Accordion.Root, { ...rootProps, children });
}

// An outer accordion whose first (open) panel embeds a second Accordion.Root,
// so the nested triggers sit inside the outer root's DOM subtree. Used to prove
// header arrow-navigation is scoped to the nearest root and doesn't leak across
// the nesting boundary.
function nestedAccordion() {
  return React.createElement(Accordion.Root, {
    defaultValue: "outer-0",
    children: [
      accordionItem(
        "outer-0",
        "Outer-A",
        React.createElement(Accordion.Root, {
          defaultValue: "inner-0",
          children: [
            accordionItem("inner-0", "Inner-A", "Inner-A body"),
            accordionItem("inner-1", "Inner-B", "Inner-B body"),
          ],
        }),
      ),
      accordionItem("outer-1", "Outer-B", "Outer-B body"),
    ],
  });
}

describe("Accordion", () => {
  it("renders all triggers and hides every panel when nothing is open", () => {
    const { getByText, queryByText } = render(
      makeAccordion({}, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    assert.ok(getByText("First"));
    assert.ok(getByText("Second"));
    assert.strictEqual(queryByText("First body"), null);
    assert.strictEqual(queryByText("Second body"), null);
  });

  it("opens the item named by defaultValue on mount", () => {
    const { getByText, queryByText } = render(
      makeAccordion({ defaultValue: "item-1" }, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    assert.ok(getByText("Second body"));
    assert.strictEqual(queryByText("First body"), null);
  });

  it("opens an item on trigger click and reflects it in aria-expanded", () => {
    const { getByText, queryByText } = render(
      makeAccordion({}, [["First", "First body"]]),
    );
    const trigger = getByText("First").closest("button");
    assert.ok(trigger);
    assert.strictEqual(trigger?.getAttribute("aria-expanded"), "false");
    assert.strictEqual(queryByText("First body"), null);

    fireEvent.click(trigger);

    assert.strictEqual(trigger?.getAttribute("aria-expanded"), "true");
    assert.ok(getByText("First body"));
  });

  it("in single mode, opening one item closes the previously open one", () => {
    const { getByText, queryByText } = render(
      makeAccordion({}, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    fireEvent.click(getByText("First"));
    assert.ok(getByText("First body"));

    fireEvent.click(getByText("Second"));
    assert.ok(getByText("Second body"));
    assert.strictEqual(queryByText("First body"), null);
  });

  it("in single mode with collapsible (default), clicking an open item closes it", () => {
    const { getByText, queryByText } = render(
      makeAccordion({}, [["First", "First body"]]),
    );
    fireEvent.click(getByText("First"));
    assert.ok(getByText("First body"));

    fireEvent.click(getByText("First"));
    assert.strictEqual(queryByText("First body"), null);
  });

  it("with collapsible={false}, an open single item stays open when re-clicked", () => {
    const { getByText } = render(
      makeAccordion({ collapsible: false, defaultValue: "item-0" }, [
        ["First", "First body"],
      ]),
    );
    assert.ok(getByText("First body"));
    fireEvent.click(getByText("First"));
    assert.ok(getByText("First body"));
  });

  it("in multiple mode, items open and close independently", () => {
    const { getByText, queryByText } = render(
      makeAccordion({ type: "multiple" }, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    fireEvent.click(getByText("First"));
    fireEvent.click(getByText("Second"));
    assert.ok(getByText("First body"));
    assert.ok(getByText("Second body"));

    fireEvent.click(getByText("First"));
    assert.strictEqual(queryByText("First body"), null);
    assert.ok(getByText("Second body"));
  });

  it("honors the controlled `value` prop and reports single-string changes", () => {
    const changes: string[] = [];
    const { getByText, queryByText, rerender } = render(
      React.createElement(Accordion.Root, {
        value: "item-0",
        onValueChange: (v: string) => changes.push(v),
        children: [
          accordionItem("item-0", "First", "First body"),
          accordionItem("item-1", "Second", "Second body"),
        ],
      }),
    );
    // controlled: only item-0 open regardless of clicks until parent updates value
    assert.ok(getByText("First body"));
    fireEvent.click(getByText("Second"));
    assert.deepStrictEqual(changes, ["item-1"]);
    // value prop did not change, so the view is unchanged
    assert.ok(getByText("First body"));
    assert.strictEqual(queryByText("Second body"), null);

    // parent moves the controlled value
    rerender(
      React.createElement(Accordion.Root, {
        value: "item-1",
        onValueChange: (v: string) => changes.push(v),
        children: [
          accordionItem("item-0", "First", "First body"),
          accordionItem("item-1", "Second", "Second body"),
        ],
      }),
    );
    assert.ok(getByText("Second body"));
    assert.strictEqual(queryByText("First body"), null);
  });

  it("wires aria-controls/id and aria-labelledby between trigger and panel", () => {
    const { getByText } = render(
      makeAccordion({ defaultValue: "item-0" }, [["First", "First body"]]),
    );
    const trigger = getByText("First").closest("button");
    const panel = getByText("First body");
    assert.ok(trigger);
    assert.strictEqual(
      trigger?.getAttribute("aria-controls"),
      panel.getAttribute("id"),
    );
    assert.strictEqual(
      panel.getAttribute("aria-labelledby"),
      trigger?.getAttribute("id"),
    );
    assert.strictEqual(panel.getAttribute("role"), "region");
  });

  it("moves focus to the next trigger on ArrowDown and wraps at the end", () => {
    const { getByText } = render(
      makeAccordion({}, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    const first = getByText("First").closest("button") as HTMLButtonElement;
    const second = getByText("Second").closest("button") as HTMLButtonElement;
    first.focus();
    assert.strictEqual(document.activeElement, first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    assert.strictEqual(document.activeElement, second);

    // wraps back to the first
    fireEvent.keyDown(second, { key: "ArrowDown" });
    assert.strictEqual(document.activeElement, first);
  });

  it("supports ArrowUp (wraps backward), Home, and End header navigation", () => {
    const { getByText } = render(
      makeAccordion({}, [
        ["First", "b0"],
        ["Second", "b1"],
        ["Third", "b2"],
      ]),
    );
    const first = getByText("First").closest("button") as HTMLButtonElement;
    const third = getByText("Third").closest("button") as HTMLButtonElement;

    first.focus();
    // ArrowUp from the first header wraps to the last.
    fireEvent.keyDown(first, { key: "ArrowUp" });
    assert.strictEqual(document.activeElement, third);
    // Home jumps to the first, End jumps to the last.
    fireEvent.keyDown(third, { key: "Home" });
    assert.strictEqual(document.activeElement, first);
    fireEvent.keyDown(first, { key: "End" });
    assert.strictEqual(document.activeElement, third);
  });

  it("emits array payloads to onValueChange in multiple mode", () => {
    const changes: string[][] = [];
    const { getByText } = render(
      React.createElement(Accordion.Root, {
        type: "multiple",
        onValueChange: (v: string[]) => changes.push(v),
        children: [
          accordionItem("item-0", "First", "First body"),
          accordionItem("item-1", "Second", "Second body"),
        ],
      }),
    );
    fireEvent.click(getByText("First"));
    fireEvent.click(getByText("Second"));
    fireEvent.click(getByText("First")); // removes item-0
    assert.deepStrictEqual(changes, [
      ["item-0"],
      ["item-0", "item-1"],
      ["item-1"],
    ]);
  });

  it("rotates the chevron and flips the item data-state when opened", () => {
    const { getByText, container } = render(
      makeAccordion({}, [["First", "First body"]]),
    );
    const trigger = getByText("First").closest("button") as HTMLButtonElement;
    const chevron = trigger.querySelector("svg");
    const item = container.querySelector("[data-state]");
    assert.ok(chevron);
    assert.strictEqual(item?.getAttribute("data-state"), "closed");
    assert.strictEqual(chevron?.classList.contains("rotate-180"), false);

    fireEvent.click(trigger);

    assert.strictEqual(item?.getAttribute("data-state"), "open");
    assert.strictEqual(chevron?.classList.contains("rotate-180"), true);
  });

  it("namespaces ids per Root so two Roots reusing a value don't collide", () => {
    const { container } = render(
      React.createElement("div", {
        children: [
          React.createElement(Accordion.Root, {
            key: "root-a",
            defaultValue: "shared",
            children: accordionItem("shared", "A", "A body"),
          }),
          React.createElement(Accordion.Root, {
            key: "root-b",
            defaultValue: "shared",
            children: accordionItem("shared", "B", "B body"),
          }),
        ],
      }),
    );
    const regions = Array.from(container.querySelectorAll('[role="region"]'));
    assert.strictEqual(regions.length, 2);
    const [r1, r2] = regions;
    assert.notStrictEqual(r1.id, r2.id, "panel ids are unique across Roots");
    // each panel still points at its OWN trigger (association not crossed)
    const triggers = Array.from(
      container.querySelectorAll("[data-accordion-trigger]"),
    );
    const t1 = triggers.find((t) => t.getAttribute("aria-controls") === r1.id);
    const t2 = triggers.find((t) => t.getAttribute("aria-controls") === r2.id);
    assert.ok(t1 && t2);
    assert.strictEqual(r1.getAttribute("aria-labelledby"), t1?.id);
    assert.strictEqual(r2.getAttribute("aria-labelledby"), t2?.id);
  });

  it("throws when a Trigger is rendered outside <Accordion.Root>", () => {
    assert.throws(
      () =>
        render(
          React.createElement(Accordion.Item, {
            value: "x",
            children: React.createElement(Accordion.Trigger, {
              children: "Orphan",
            }),
          }),
        ),
      /must be used inside <Accordion\.Root>/,
    );
  });

  it("throws when Content is rendered outside <Accordion.Item>", () => {
    assert.throws(
      () =>
        render(
          React.createElement(Accordion.Root, {
            children: React.createElement(Accordion.Content, {
              children: "Orphan body",
            }),
          }),
        ),
      /must be used inside <Accordion\.Item>/,
    );
  });

  it("scopes queries so labels of closed siblings never leak", () => {
    const { container } = render(
      makeAccordion({ defaultValue: "item-0" }, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    const region = within(container).getByRole("region");
    assert.strictEqual(region.textContent, "First body");
  });

  it("honors a controlled `value` array in multiple mode without self-updating", () => {
    const changes: string[][] = [];
    const tree = (value: string[]) =>
      React.createElement(Accordion.Root, {
        type: "multiple",
        value,
        onValueChange: (v: string[]) => changes.push(v),
        children: [
          accordionItem("item-0", "First", "First body"),
          accordionItem("item-1", "Second", "Second body"),
        ],
      });
    const { getByText, queryByText, rerender } = render(tree(["item-0"]));
    // Controlled to a single-element array: only item-0 is open.
    assert.ok(getByText("First body"));
    assert.strictEqual(queryByText("Second body"), null);

    // Clicking a closed item emits the requested next array (add) but the view
    // stays put until the parent moves `value`.
    fireEvent.click(getByText("Second"));
    assert.deepStrictEqual(changes, [["item-0", "item-1"]]);
    assert.strictEqual(queryByText("Second body"), null);

    // Parent opens both; clicking an open item emits the removal array.
    rerender(tree(["item-0", "item-1"]));
    assert.ok(getByText("First body"));
    assert.ok(getByText("Second body"));
    fireEvent.click(getByText("First"));
    assert.deepStrictEqual(changes, [["item-0", "item-1"], ["item-1"]]);
  });

  it("marks the open trigger aria-disabled only when single + collapsible={false}", () => {
    const locked = render(
      makeAccordion({ collapsible: false, defaultValue: "item-0" }, [
        ["First", "First body"],
        ["Second", "Second body"],
      ]),
    );
    // The open, non-collapsible item can't be toggled shut → aria-disabled.
    assert.strictEqual(
      locked
        .getByText("First")
        .closest("button")
        ?.getAttribute("aria-disabled"),
      "true",
    );
    // A closed sibling is still openable → no aria-disabled.
    assert.strictEqual(
      locked
        .getByText("Second")
        .closest("button")
        ?.getAttribute("aria-disabled"),
      null,
    );
    cleanup();

    // Default (collapsible) open item is toggleable → attribute omitted.
    const collapsible = render(
      makeAccordion({ defaultValue: "item-0" }, [["First", "First body"]]),
    );
    assert.strictEqual(
      collapsible
        .getByText("First")
        .closest("button")
        ?.getAttribute("aria-disabled"),
      null,
    );
  });

  it("does not let header navigation leak into a nested accordion", () => {
    const { getByText } = render(nestedAccordion());
    const outerA = getByText("Outer-A").closest("button") as HTMLButtonElement;
    const outerB = getByText("Outer-B").closest("button") as HTMLButtonElement;
    const innerA = getByText("Inner-A").closest("button") as HTMLButtonElement;
    const innerB = getByText("Inner-B").closest("button") as HTMLButtonElement;

    // ArrowDown on the OUTER header skips the nested triggers (which sit in the
    // outer root's DOM subtree) and lands on the next OUTER header.
    outerA.focus();
    fireEvent.keyDown(outerA, { key: "ArrowDown" });
    assert.strictEqual(document.activeElement, outerB);

    // ArrowDown inside the NESTED accordion cycles only its own headers.
    innerA.focus();
    fireEvent.keyDown(innerA, { key: "ArrowDown" });
    assert.strictEqual(document.activeElement, innerB);
    fireEvent.keyDown(innerB, { key: "ArrowDown" });
    assert.strictEqual(document.activeElement, innerA); // wraps within the nested root
  });
});
