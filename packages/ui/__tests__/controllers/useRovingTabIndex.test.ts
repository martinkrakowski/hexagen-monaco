import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, act } from "@testing-library/react";
import { useRovingTabIndex } from "../../src/controllers/useRovingTabIndex.js";
import type { UseRovingTabIndexOptions } from "../../src/controllers/useRovingTabIndex.js";

afterEach(() => {
  cleanup();
});

/**
 * Renders a real button group driven by the hook, so focus and tabIndex are
 * observed on actual DOM nodes. A mock harness would let the hook "pass" while
 * still never focusing anything -- which is precisely how the previous
 * implementation stayed broken.
 */
function harness(options: UseRovingTabIndexOptions) {
  const api: { current: ReturnType<typeof useRovingTabIndex> | null } = {
    current: null,
  };

  function Group() {
    const roving = useRovingTabIndex(options);
    api.current = roving;
    return React.createElement(
      "div",
      { role: "radiogroup" },
      Array.from({ length: options.itemCount }, (_unused, index) =>
        React.createElement("button", {
          key: index,
          type: "button",
          ref: roving.setItemRef(index),
          tabIndex: roving.getTabIndex(index),
          "data-index": String(index),
        }),
      ),
    );
  }

  const utils = render(React.createElement(Group));
  const buttons = Array.from(
    utils.container.querySelectorAll("button"),
  ) as HTMLButtonElement[];
  return { api, buttons };
}

const tabIndexes = (buttons: HTMLButtonElement[]) =>
  buttons.map((b) => b.getAttribute("tabindex"));

describe("useRovingTabIndex", () => {
  it("puts exactly one item in the tab order", () => {
    const { buttons } = harness({ itemCount: 3 });
    // The group is ONE tab stop. The old implementation returned a hardcoded
    // tabIndex 0 and never -1, so every item was a stop.
    assert.deepStrictEqual(tabIndexes(buttons), ["0", "-1", "-1"]);
  });

  it("honours initialIndex", () => {
    const { buttons } = harness({ itemCount: 3, initialIndex: 2 });
    assert.deepStrictEqual(tabIndexes(buttons), ["-1", "-1", "0"]);
  });

  it("actually moves DOM focus, not just state", () => {
    const { api, buttons } = harness({ itemCount: 3 });
    act(() => api.current?.focusNext());
    assert.strictEqual(document.activeElement, buttons[1]);
    assert.deepStrictEqual(tabIndexes(buttons), ["-1", "0", "-1"]);
  });

  it("stops at the ends when not circular", () => {
    const { api, buttons } = harness({ itemCount: 3 });
    act(() => api.current?.focusPrevious());
    assert.strictEqual(api.current?.activeIndex, 0);
    act(() => api.current?.focusLast());
    act(() => api.current?.focusNext());
    assert.strictEqual(api.current?.activeIndex, 2);
    assert.strictEqual(document.activeElement, buttons[2]);
  });

  it("wraps both ends when circular", () => {
    // The old clamp computed `x % 0` here, because totalItems was never
    // assigned, so every circular move produced NaN.
    const { api } = harness({ itemCount: 3, circular: true });
    act(() => api.current?.focusPrevious());
    assert.strictEqual(api.current?.activeIndex, 2);
    act(() => api.current?.focusNext());
    assert.strictEqual(api.current?.activeIndex, 0);
  });

  it("skips disabled items instead of stopping on them", () => {
    const { api } = harness({ itemCount: 4, disabledIndices: [1, 2] });
    act(() => api.current?.focusNext());
    assert.strictEqual(api.current?.activeIndex, 3);
  });

  it("starts on the first focusable item when index 0 is disabled", () => {
    const { api, buttons } = harness({ itemCount: 3, disabledIndices: [0] });
    assert.strictEqual(api.current?.activeIndex, 1);
    assert.deepStrictEqual(tabIndexes(buttons), ["-1", "0", "-1"]);
  });

  it("keeps the group reachable when the active item becomes disabled", () => {
    // Otherwise the only tab stop vanishes and the whole group silently drops
    // out of the tab order.
    const { api, buttons } = harness({ itemCount: 3, disabledIndices: [0] });
    assert.strictEqual(api.current?.activeIndex, 1);
    assert.ok(tabIndexes(buttons).includes("0"));
  });

  it("is unreachable when every item is disabled", () => {
    const { api, buttons } = harness({
      itemCount: 2,
      disabledIndices: [0, 1],
    });
    assert.strictEqual(api.current?.activeIndex, -1);
    assert.deepStrictEqual(tabIndexes(buttons), ["-1", "-1"]);
  });

  it("does not divide by zero with no items", () => {
    const { api } = harness({ itemCount: 0, circular: true });
    act(() => api.current?.focusNext());
    assert.strictEqual(api.current?.activeIndex, -1);
  });

  it("ignores focusAt on a disabled or out-of-range item", () => {
    const { api } = harness({ itemCount: 3, disabledIndices: [1] });
    act(() => api.current?.focusAt(1));
    assert.strictEqual(api.current?.activeIndex, 0);
    act(() => api.current?.focusAt(99));
    assert.strictEqual(api.current?.activeIndex, 0);
  });

  it("focusFirst and focusLast land on focusable items", () => {
    const { api } = harness({ itemCount: 4, disabledIndices: [0, 3] });
    act(() => api.current?.focusLast());
    assert.strictEqual(api.current?.activeIndex, 2);
    act(() => api.current?.focusFirst());
    assert.strictEqual(api.current?.activeIndex, 1);
  });
});
