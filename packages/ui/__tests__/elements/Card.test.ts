import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../src/elements/Card.js";

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

describe("Card components", () => {
  describe("Card", () => {
    it("renders card div element", () => {
      const { container } = render(React.createElement(Card, null));
      const card = container.querySelector("div");
      assert.ok(card instanceof dom.window.HTMLDivElement);
    });

    it("forwards ref to underlying div", () => {
      const ref = React.createRef();
      render(React.createElement(Card, { ref }));
      assert.ok(ref.current instanceof dom.window.HTMLDivElement);
    });

    it("applies card styling classes", () => {
      const { container } = render(React.createElement(Card, null));
      const card = container.querySelector("div");
      assert.match(card.className, /rounded-md/);
      assert.match(card.className, /border-border/);
      assert.match(card.className, /bg-card/);
      assert.match(card.className, /shadow-sm/);
    });

    it("merges custom className", () => {
      const { container } = render(
        React.createElement(Card, { className: "custom-card" }),
      );
      const card = container.querySelector("div");
      assert.match(card.className, /custom-card/);
    });
  });

  describe("CardHeader", () => {
    it("renders header div", () => {
      const { container } = render(React.createElement(CardHeader, null));
      const header = container.querySelector("div");
      assert.ok(header instanceof dom.window.HTMLDivElement);
    });

    it("applies header styling classes", () => {
      const { container } = render(React.createElement(CardHeader, null));
      const header = container.querySelector("div");
      assert.match(header.className, /flex/);
      assert.match(header.className, /flex-col/);
      assert.match(header.className, /space-y-1\.5/);
      assert.match(header.className, /px-4/);
      assert.match(header.className, /py-4/);
    });

    it("forwards ref", () => {
      const ref = React.createRef();
      render(React.createElement(CardHeader, { ref }));
      assert.ok(ref.current instanceof dom.window.HTMLDivElement);
    });
  });

  describe("CardTitle", () => {
    it("renders as h3 by default", () => {
      const { container } = render(
        React.createElement(CardTitle, null, "Test Title"),
      );
      const title = container.querySelector("h3");
      assert.ok(title);
      assert.strictEqual(title?.textContent, "Test Title");
    });

    it("renders as custom heading element", () => {
      const { container } = render(
        React.createElement(CardTitle, { as: "h1" }, "H1 Title"),
      );
      const title = container.querySelector("h1");
      assert.ok(title);
    });

    it("applies title styling classes", () => {
      const { container } = render(
        React.createElement(CardTitle, null, "Title"),
      );
      const title = container.querySelector("h3");
      assert.match(title?.className ?? "", /text-base/);
      assert.match(title?.className ?? "", /font-semibold/);
    });

    it("forwards ref", () => {
      const ref = React.createRef<HTMLHeadingElement>();
      render(React.createElement(CardTitle, { ref }, "Title"));
      assert.ok(ref.current instanceof dom.window.HTMLHeadingElement);
    });
  });

  describe("CardContent", () => {
    it("renders content div", () => {
      const { container } = render(
        React.createElement(CardContent, null, "Content"),
      );
      const content = container.querySelector("div");
      assert.ok(content instanceof dom.window.HTMLDivElement);
    });

    it("applies content styling", () => {
      const { container } = render(React.createElement(CardContent, null));
      const content = container.querySelector("div");
      assert.match(content?.className ?? "", /pt-0/);
    });

    it("forwards ref", () => {
      const ref = React.createRef();
      render(React.createElement(CardContent, { ref }));
      assert.ok(ref.current instanceof dom.window.HTMLDivElement);
    });
  });
});
