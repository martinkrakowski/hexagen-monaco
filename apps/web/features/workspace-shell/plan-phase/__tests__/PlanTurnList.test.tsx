import { describe, it, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, cleanup, screen } from "@testing-library/react";

import { PlanTurnList } from "../PlanTurnList";

describe("PlanTurnList", () => {
  beforeEach(() => cleanup());

  it("renders each turn with its author label and markdown content", () => {
    render(
      <PlanTurnList
        turns={[
          { id: "t1", author: "Grok", content: "A **bold** proposal" },
          { id: "t2", author: "Claude", content: "A critique" },
        ]}
      />,
    );
    assert.ok(screen.getByText("Grok"));
    assert.ok(screen.getByText("Claude"));
    // Markdown is rendered, not shown as literal ** markers.
    const strong = document.querySelector("strong");
    assert.ok(strong, "markdown bold renders as <strong>");
    assert.strictEqual(strong.textContent, "bold");
  });

  it("gives distinct authors distinct accents, stable across their turns", () => {
    render(
      <PlanTurnList
        turns={[
          { id: "t1", author: "Grok", content: "one" },
          { id: "t2", author: "Claude", content: "two" },
          { id: "t3", author: "Grok", content: "three" },
        ]}
      />,
    );
    const items = Array.from(document.querySelectorAll("li"));
    assert.strictEqual(items.length, 3);
    const accent = (li: Element) =>
      Array.from(li.classList).find(
        // The accent is the colored border-l-* token; border-l-2 is the shared
        // width utility present on every item.
        (c) => c.startsWith("border-l-") && c !== "border-l-2",
      );
    // Alternating per author: Grok ≠ Claude, and Grok's two turns match.
    assert.notStrictEqual(accent(items[0]), accent(items[1]));
    assert.strictEqual(accent(items[0]), accent(items[2]));
  });

  it("renders a timestamp only when the turn has one", () => {
    render(
      <PlanTurnList
        turns={[
          { id: "t1", author: "You", content: "dated", at: 1720000000000 },
          { id: "t2", author: "You", content: "undated" },
        ]}
      />,
    );
    const items = Array.from(document.querySelectorAll("li"));
    const meta = (li: Element) =>
      li.querySelector(".text-muted-foreground")?.textContent ?? "";
    assert.ok(meta(items[0]).length > 0, "dated turn shows a timestamp");
    assert.strictEqual(meta(items[1]), "", "undated turn shows no timestamp");
  });

  it("renders an empty list without crashing", () => {
    render(<PlanTurnList turns={[]} />);
    assert.strictEqual(document.querySelectorAll("li").length, 0);
  });
});
