import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatMarkdown } from "../ChatMarkdown";

afterEach(cleanup);

describe("ChatMarkdown", () => {
  it("renders markdown as HTML elements, not raw text", () => {
    const { container } = render(
      <ChatMarkdown
        content={"**bold** and `code`\n\n- one\n- two\n\n# Heading"}
      />,
    );
    // Bold → <strong> (not literal "**").
    assert.strictEqual(
      screen.getByText("bold").tagName,
      "STRONG",
      "bold renders as <strong>",
    );
    // Inline code → <code>.
    assert.ok(container.querySelector("code"), "inline code renders as <code>");
    // List → two <li>.
    assert.strictEqual(
      container.querySelectorAll("li").length,
      2,
      "list renders as <li> items",
    );
    // Heading → <h1>.
    assert.ok(container.querySelector("h1"), "# renders as a heading");
    // The raw markdown markers are gone (the bug was showing these literally).
    assert.ok(
      !container.textContent?.includes("**"),
      "no literal ** markers leak through",
    );
  });

  it("renders a GFM table (remark-gfm enabled)", () => {
    const { container } = render(
      <ChatMarkdown content={"| a | b |\n|---|---|\n| 1 | 2 |"} />,
    );
    assert.ok(container.querySelector("table"), "GFM table renders");
    assert.strictEqual(container.querySelectorAll("td").length, 2);
  });

  it("renders untrusted images as inert alt-text (no <img>, no remote fetch)", () => {
    const { container } = render(
      <ChatMarkdown content={"![tracker](https://evil.example/pixel.png)"} />,
    );
    assert.strictEqual(
      container.querySelector("img"),
      null,
      "no <img> element is created from model markdown",
    );
    assert.ok(
      container.textContent?.includes("tracker"),
      "the alt text is shown instead",
    );
  });

  it("opens links in a new tab with a safe rel", () => {
    const { container } = render(
      <ChatMarkdown content={"[site](https://example.com)"} />,
    );
    const a = container.querySelector("a");
    assert.strictEqual(a?.getAttribute("target"), "_blank");
    assert.match(a?.getAttribute("rel") ?? "", /noopener/);
    assert.match(a?.getAttribute("rel") ?? "", /noreferrer/);
  });
});
