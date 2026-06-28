import React from "react";
import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { parseYamlToViewData } from "@hexagen/manifest-generation";
import { ContextMapView } from "../ContextMapView";
import { useContextChatPanel } from "../store/useContextChatPanel";

const YAML = `bounded_contexts:
  - name: orders
    type: core
    aggregates:
      - name: Order
        root: true
  - name: billing
    type: supporting
`;

afterEach(() => {
  cleanup();
  useContextChatPanel.setState({ selectedContext: null, isOpen: false });
});

describe("ContextMapView — AI affordance", () => {
  it("renders an AI Sparkles icon per context and no bare health dot", () => {
    const viewData = parseYamlToViewData(YAML);
    const { container } = render(<ContextMapView viewData={viewData} />);

    // The health-tinted AI sparkle replaces the old pulsing dot — one per card.
    assert.strictEqual(
      container.querySelectorAll("svg.lucide-sparkles").length,
      viewData.contexts.length,
      "each context card renders a Sparkles AI icon",
    );
    // The old health indicator was a bare `w-2 h-2 rounded-full` dot — gone now.
    assert.strictEqual(
      container.querySelector("span.rounded-full.animate-soft-pulse"),
      null,
      "the bare pulsing health dot is removed",
    );
  });

  it("each context card is a button that opens the AI chat for that context", () => {
    const viewData = parseYamlToViewData(YAML);
    render(<ContextMapView viewData={viewData} />);

    const card = screen.getByRole("button", {
      name: /ask ai about the orders context/i,
    });
    assert.ok(card, "the orders card exposes an Ask-AI button affordance");

    assert.strictEqual(useContextChatPanel.getState().isOpen, false);
    fireEvent.click(card);

    const state = useContextChatPanel.getState();
    assert.strictEqual(state.isOpen, true, "clicking opens the drawer");
    assert.strictEqual(
      state.selectedContext?.name,
      "orders",
      "the clicked context is selected",
    );
  });

  it("opens via keyboard (Enter and Space) for accessibility", () => {
    // The card's onKeyDown activates on both Enter and Space.
    for (const key of ["Enter", " "]) {
      const viewData = parseYamlToViewData(YAML);
      const { unmount } = render(<ContextMapView viewData={viewData} />);

      const card = screen.getByRole("button", {
        name: /ask ai about the billing context/i,
      });
      fireEvent.keyDown(card, { key });

      assert.strictEqual(
        useContextChatPanel.getState().selectedContext?.name,
        "billing",
        `key "${key}" opens the billing context`,
      );

      unmount();
      useContextChatPanel.setState({ selectedContext: null, isOpen: false });
    }
  });
});
