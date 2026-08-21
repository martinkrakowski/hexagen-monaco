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

  it("returns a stable ref callback per index across re-renders", () => {
    // A fresh closure per call makes React tear down and re-attach every ref
    // on every re-render -- and this hook re-renders on each arrow keypress,
    // so an N-item group paid 2N detach/attach cycles per keystroke. Focus
    // still worked, which is exactly why it was easy to miss.
    const identities: boolean[] = [];
    // Boxed rather than a bare `let`: TS narrows a `let` assigned only inside
    // a component closure to `never` at the assertion site, so reading
    // `.activeIndex` off it fails typecheck:test (a separate turbo task).
    const api: { current: ReturnType<typeof useRovingTabIndex> | null } = {
      current: null,
    };
    let previous: unknown = null;

    function Group() {
      const roving = useRovingTabIndex({ itemCount: 3 });
      api.current = roving;
      const callback = roving.setItemRef(0);
      identities.push(previous === null || previous === callback);
      previous = callback;
      return React.createElement(
        "div",
        null,
        Array.from({ length: 3 }, (_unused, index) =>
          React.createElement("button", {
            key: index,
            type: "button",
            ref: roving.setItemRef(index),
          }),
        ),
      );
    }

    render(React.createElement(Group));
    act(() => api.current?.focusNext());
    act(() => api.current?.focusNext());

    assert.ok(identities.length >= 3, "expected multiple renders");
    assert.ok(
      identities.every(Boolean),
      "setItemRef(0) returned a new identity across renders",
    );
    // And focus still lands correctly with the cached callbacks.
    assert.strictEqual(api.current?.activeIndex, 2);
  });

  describe("when the active item becomes disabled", () => {
    function disableHarness() {
      const api: { current: ReturnType<typeof useRovingTabIndex> | null } = {
        current: null,
      };
      const setDisabled: { current: ((next: number[]) => void) | null } = {
        current: null,
      };

      function Group() {
        const [disabled, setter] = React.useState<number[]>([]);
        setDisabled.current = setter;
        const roving = useRovingTabIndex({
          itemCount: 3,
          disabledIndices: disabled,
        });
        api.current = roving;
        return React.createElement(
          "div",
          null,
          Array.from({ length: 3 }, (_unused, index) =>
            React.createElement("button", {
              key: index,
              type: "button",
              disabled: disabled.includes(index),
              tabIndex: roving.getTabIndex(index),
              ref: roving.setItemRef(index),
            }),
          ),
        );
      }

      const utils = render(React.createElement(Group));
      const buttons = () =>
        Array.from(utils.container.querySelectorAll("button"));
      return { api, setDisabled, buttons };
    }

    it("does not leave focus sitting on the disabled item", () => {
      const { api, setDisabled, buttons } = disableHarness();
      act(() => api.current?.focusNext());
      assert.strictEqual(document.activeElement, buttons()[1]);
      act(() => setDisabled.current?.([1]));
      assert.notStrictEqual(
        document.activeElement,
        buttons()[1],
        "focus was left on a disabled control",
      );
      assert.strictEqual(document.activeElement, buttons()[0]);
    });

    it("does not resurrect the stale index when the item is re-enabled", () => {
      // Deriving the fallback without committing it left activeIndex stale,
      // so re-enabling moved the tab stop back with no user action.
      const { api, setDisabled } = disableHarness();
      act(() => api.current?.focusNext());
      assert.strictEqual(api.current?.activeIndex, 1);
      act(() => setDisabled.current?.([1]));
      assert.strictEqual(api.current?.activeIndex, 0);
      act(() => setDisabled.current?.([]));
      assert.strictEqual(
        api.current?.activeIndex,
        0,
        "the tab stop jumped back to the previously disabled item",
      );
    });

    it("does not steal focus that lives outside the group", () => {
      const { setDisabled, buttons } = disableHarness();
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      outside.focus();
      assert.strictEqual(document.activeElement, outside);
      act(() => setDisabled.current?.([0]));
      assert.strictEqual(
        document.activeElement,
        outside,
        "focus was stolen from outside the group",
      );
      assert.ok(buttons().length === 3);
      outside.remove();
    });
  });
});
