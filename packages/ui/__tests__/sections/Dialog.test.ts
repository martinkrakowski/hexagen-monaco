import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../src/sections/Dialog.js";

let dom: JSDOM;
let originalCreateElement: typeof dom.window.document.createElement;

before(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, "navigator", {
    value: dom.window.navigator,
    writable: true,
  });
  const mockDialog = {
    showModal: () => {},
    close: () => {},
    open: false,
  };
  originalCreateElement = dom.window.document.createElement.bind(
    dom.window.document,
  );
  dom.window.document.createElement = (tagName: string) => {
    const el = originalCreateElement(tagName);
    if (tagName === "dialog") {
      Object.assign(el, mockDialog);
    }
    return el;
  };
});

after(() => {
  dom.window.document.createElement = originalCreateElement;
});

afterEach(() => {
  cleanup();
});

describe("Dialog component", () => {
  describe("Dialog", () => {
    it("does not render children when closed", () => {
      const { queryByText } = render(
        React.createElement(
          Dialog,
          { open: false, onClose: () => {} },
          "Dialog content",
        ),
      );
      assert.strictEqual(queryByText("Dialog content"), null);
    });

    it("renders dialog element when open", () => {
      const { container } = render(
        React.createElement(
          Dialog,
          { open: true, onClose: () => {} },
          "Content",
        ),
      );
      const dialog = container.querySelector("dialog");
      assert.ok(dialog);
    });

    it("renders children when open", () => {
      const { getByText } = render(
        React.createElement(
          Dialog,
          { open: true, onClose: () => {} },
          "Dialog content",
        ),
      );
      assert.ok(getByText("Dialog content"));
    });

    it("calls onClose on backdrop click", () => {
      let closed = false;
      const { container } = render(
        React.createElement(
          Dialog,
          {
            open: true,
            onClose: () => {
              closed = true;
            },
          },
          "Content",
        ),
      );
      const dialog = container.querySelector("dialog");
      fireEvent.click(dialog);
      assert.strictEqual(closed, true);
    });
  });

  describe("DialogContent", () => {
    it("renders div with correct classes", () => {
      const { container } = render(
        React.createElement(DialogContent, null, "Content"),
      );
      const div = container.querySelector("div");
      assert.ok(div);
      assert.match(div?.className ?? "", /bg-card/);
      assert.match(div?.className ?? "", /rounded-md/);
      assert.match(div?.className ?? "", /shadow-lg/);
    });

    it("applies custom className", () => {
      const { container } = render(
        React.createElement(
          DialogContent,
          { className: "custom-dialog" },
          "Content",
        ),
      );
      const div = container.querySelector("div");
      assert.match(div?.className ?? "", /custom-dialog/);
    });

    it("sets role to document", () => {
      const { container } = render(React.createElement(DialogContent, null));
      const div = container.querySelector("div");
      assert.strictEqual(div?.getAttribute("role"), "document");
    });
  });

  describe("DialogHeader", () => {
    it("renders header div", () => {
      const { container } = render(
        React.createElement(DialogHeader, null, "Header"),
      );
      const div = container.querySelector("div");
      assert.ok(div);
    });

    it("applies header styling", () => {
      const { container } = render(React.createElement(DialogHeader, null));
      const div = container.querySelector("div");
      assert.match(div?.className ?? "", /flex/);
      assert.match(div?.className ?? "", /flex-col/);
      assert.match(div?.className ?? "", /space-y-1\.5/);
      assert.match(div?.className ?? "", /mb-4/);
    });
  });

  describe("DialogTitle", () => {
    it("renders h2 element", () => {
      const { container } = render(
        React.createElement(DialogTitle, null, "Title"),
      );
      const h2 = container.querySelector("h2");
      assert.ok(h2);
      assert.strictEqual(h2?.textContent, "Title");
    });

    it("applies title styling", () => {
      const { container } = render(React.createElement(DialogTitle, null));
      const h2 = container.querySelector("h2");
      assert.match(h2?.className ?? "", /text-lg/);
      assert.match(h2?.className ?? "", /font-semibold/);
    });
  });

  describe("DialogDescription", () => {
    it("renders p element", () => {
      const { container } = render(
        React.createElement(DialogDescription, null, "Description"),
      );
      const p = container.querySelector("p");
      assert.ok(p);
      assert.strictEqual(p?.textContent, "Description");
    });

    it("applies description styling", () => {
      const { container } = render(
        React.createElement(DialogDescription, null),
      );
      const p = container.querySelector("p");
      assert.match(p?.className ?? "", /text-sm/);
      assert.match(p?.className ?? "", /text-muted-foreground/);
    });
  });

  describe("DialogFooter", () => {
    it("renders footer div", () => {
      const { container } = render(
        React.createElement(DialogFooter, null, "Footer"),
      );
      const div = container.querySelector("div");
      assert.ok(div);
    });

    it("applies footer styling", () => {
      const { container } = render(React.createElement(DialogFooter, null));
      const div = container.querySelector("div");
      assert.match(div?.className ?? "", /flex/);
      assert.match(div?.className ?? "", /justify-end/);
      assert.match(div?.className ?? "", /gap-3/);
      assert.match(div?.className ?? "", /mt-6/);
    });
  });
});
