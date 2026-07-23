import { describe, it, beforeAll, afterAll, afterEach } from "vitest";
import assert from "node:assert";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TwoPaneLayout } from "../TwoPaneLayout";

// react-resizable-panels (the desktop path) instantiates a ResizeObserver on
// mount; jsdom doesn't ship one. A no-op stub lets the panels render. Capture
// whatever was there first and restore it in afterAll so this stub doesn't leak
// into sibling suites sharing the worker (which may rely on its absence).
const hadResizeObserver = "ResizeObserver" in globalThis;
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});
afterAll(() => {
  if (hadResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

const DEFAULT_WIDTH = 1024;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  cleanup();
  setViewportWidth(DEFAULT_WIDTH); // reset to the "lg" default
});

const baseProps = {
  left: <div>LEFT-PANE</div>,
  right: <div>RIGHT-PANE</div>,
  leftTitle: "Workspace",
  rightTitle: "Session",
};

describe("TwoPaneLayout", () => {
  describe("desktop (lg)", () => {
    beforeAll(() => setViewportWidth(DEFAULT_WIDTH));

    it("renders both columns and the left header title", () => {
      render(<TwoPaneLayout {...baseProps} />);
      assert.ok(screen.getByText("LEFT-PANE"));
      assert.ok(screen.getByText("RIGHT-PANE"));
      // PanelHeader renders the left title.
      assert.ok(screen.getByText("Workspace"));
    });

    it("exposes a collapse control for the left column", () => {
      render(<TwoPaneLayout {...baseProps} />);
      assert.ok(
        screen.getByRole("button", { name: "Collapse Workspace" }),
        "left PanelHeader renders a collapse button",
      );
      // NB: actually clicking Collapse can't be asserted here — the imperative
      // panel.collapse() throws "Panel size not found" without a real layout
      // pass (react-resizable-panels needs a functioning ResizeObserver that
      // jsdom lacks), so onLeftPanelClose can't be exercised in a unit test.
      // Its wiring lives in the shared usePanelCollapse hook, exercised by the
      // existing three-panel layout.
    });

    it("renders the left footer when provided", () => {
      render(
        <TwoPaneLayout
          {...baseProps}
          leftFooter={<button type="button">Add planning session</button>}
        />,
      );
      assert.ok(screen.getByRole("button", { name: "Add planning session" }));
    });

    it("omits the footer region when no leftFooter is given", () => {
      render(<TwoPaneLayout {...baseProps} />);
      assert.strictEqual(screen.queryByText("Add planning session"), null);
    });
  });

  describe("mobile (tabs)", () => {
    it("renders two tabs and shows the left column with its footer first", () => {
      setViewportWidth(500);
      render(
        <TwoPaneLayout
          {...baseProps}
          leftFooter={<button type="button">Add planning session</button>}
        />,
      );
      // Two tab buttons, labelled by the two titles. The visible label span is
      // `hidden` below `sm`; jsdom applies no Tailwind CSS, so asserting the
      // accessible name alone wouldn't prove the mobile case. Pin the explicit
      // aria-label so the name survives even when the span is display:none.
      const formTab = screen.getByRole("button", { name: "Workspace" });
      const sessionTab = screen.getByRole("button", { name: "Session" });
      assert.strictEqual(formTab.getAttribute("aria-label"), "Workspace");
      assert.strictEqual(sessionTab.getAttribute("aria-label"), "Session");
      // First tab (form) is active: left content + footer visible, right hidden.
      assert.ok(screen.getByText("LEFT-PANE"));
      assert.ok(screen.getByRole("button", { name: "Add planning session" }));
      assert.strictEqual(screen.queryByText("RIGHT-PANE"), null);
    });

    it("switches to the right column when its tab is selected", () => {
      setViewportWidth(500);
      render(<TwoPaneLayout {...baseProps} />);
      assert.strictEqual(screen.queryByText("RIGHT-PANE"), null);

      fireEvent.click(screen.getByRole("button", { name: "Session" }));

      assert.ok(screen.getByText("RIGHT-PANE"));
      assert.strictEqual(screen.queryByText("LEFT-PANE"), null);
    });
  });
});
