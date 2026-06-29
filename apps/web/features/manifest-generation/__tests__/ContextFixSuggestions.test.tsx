import React from "react";
import { describe, it, afterEach, beforeAll } from "vitest";
import assert from "node:assert";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

beforeAll(() => {
  // jsdom doesn't implement <dialog>.showModal/close, which the @hexagen/ui
  // Dialog calls; stub them so the confirm dialog can mount.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  }
});
import { ContextFixSuggestions } from "../ContextFixSuggestions";
import { usePendingManifest } from "../store/usePendingManifest";
import type { ContextFix } from "../request-context-fixes";

const YAML = [
  "bounded_contexts:",
  "  - name: scene-types",
  "    type: shared-kernel",
  "    layers:",
  "      application:",
  "        ports:",
  "          in:",
  "            - SceneTypesCommandPort",
  "          out: []",
  "      infrastructure:",
  "        adapters:",
  "          - SceneTypesRepositoryAdapter",
  "",
].join("\n");

const fix: ContextFix = {
  id: "fix-0",
  label: "Make scene-types type-only",
  rationale: "A shared-kernel owns no ports or adapters.",
  ops: [
    {
      op: "remove-in-port",
      context: "scene-types",
      name: "SceneTypesCommandPort",
    },
    {
      op: "remove-adapter",
      context: "scene-types",
      name: "SceneTypesRepositoryAdapter",
    },
  ],
};

afterEach(() => {
  cleanup();
  usePendingManifest.setState({ yaml: null });
});

describe("ContextFixSuggestions", () => {
  it("applies a confirmed fix to the manifest via updateYaml", () => {
    usePendingManifest.setState({ yaml: YAML });
    let appliedId: string | null = null;
    render(
      <ContextFixSuggestions
        fixes={[fix]}
        status="ready"
        appliedIds={new Set()}
        onApplied={(id) => {
          appliedId = id;
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /make scene-types type-only/i }),
    );

    // Confirmation dialog lists the exact ops (query by text — a <dialog>
    // subtree is excluded from the a11y tree, so getByRole would miss it).
    assert.ok(screen.getByText(/remove inbound port/i));
    assert.ok(screen.getByText(/remove adapter/i));

    fireEvent.click(screen.getByText(/^apply$/i));

    const out = usePendingManifest.getState().yaml ?? "";
    assert.ok(!out.includes("SceneTypesCommandPort"), "inbound port removed");
    assert.ok(!out.includes("SceneTypesRepositoryAdapter"), "adapter removed");
    assert.ok(out.includes("scene-types"), "the context itself is kept");
    assert.strictEqual(appliedId, "fix-0", "the fix is reported applied");
  });

  it("keeps the fix active and shows a notice when nothing applies", () => {
    // scene-types is already type-only here, so the fix's remove-ops are all
    // skipped (applied === 0): no write, no applied-mark, button stays enabled.
    const TYPE_ONLY = [
      "bounded_contexts:",
      "  - name: scene-types",
      "    type: shared-kernel",
      "",
    ].join("\n");
    usePendingManifest.setState({ yaml: TYPE_ONLY });
    let appliedId: string | null = null;
    render(
      <ContextFixSuggestions
        fixes={[fix]}
        status="ready"
        appliedIds={new Set()}
        onApplied={(id) => {
          appliedId = id;
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /make scene-types type-only/i }),
    );
    fireEvent.click(screen.getByText(/^apply$/i));

    // Notice lives inside the <dialog> subtree (excluded from the a11y tree), so
    // query by text like the op-list assertions above.
    assert.ok(screen.getByText(/nothing to apply/i), "a notice is shown");
    assert.strictEqual(appliedId, null, "the fix is not marked applied");
    assert.strictEqual(
      usePendingManifest.getState().yaml,
      TYPE_ONLY,
      "the manifest is untouched",
    );
    // The trigger button is still enabled (not disabled/checked).
    assert.ok(
      !screen
        .getByRole("button", { name: /make scene-types type-only/i })
        .hasAttribute("disabled"),
    );
  });

  it("renders nothing with no fixes, and a hint while loading", () => {
    const { container, rerender } = render(
      <ContextFixSuggestions
        fixes={[]}
        status="ready"
        appliedIds={new Set()}
        onApplied={() => {}}
      />,
    );
    assert.strictEqual(container.textContent, "");
    rerender(
      <ContextFixSuggestions
        fixes={[]}
        status="loading"
        appliedIds={new Set()}
        onApplied={() => {}}
      />,
    );
    assert.ok(screen.getByText(/looking for fixes/i));
  });
});
