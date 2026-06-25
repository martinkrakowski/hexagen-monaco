import React from "react";
import { test, describe, afterEach, beforeEach } from "vitest";
import assert from "node:assert";
import { render, screen, cleanup } from "@testing-library/react";
import { ManifestPreview } from "../ManifestPreview";

// The desktop YAML column is now a react-resizable-panels `PanelGroup`, which
// can't mount under this repo's jsdom (its resize-handle registration trips a
// jsdom addEventListener/AbortSignal incompatibility). The panel layout + the
// resize handle are desktop-only, so force the mobile (non-panel) branch here to
// keep these render/interaction tests isolated; the desktop resizable column and
// its drag handle are verified manually.
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 600,
  });
});
afterEach(cleanup);

describe("ManifestPreview", () => {
  const validYaml = `bounded_contexts:
  - name: test-context
    aggregates:
      - name: test-aggregate
        root: true
`;

  test("renders YAML preview correctly with valid manifest", () => {
    render(
      <ManifestPreview
        manifestYaml={validYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
      />,
    );

    assert.ok(screen.getByText(/generated manifest/i));
    assert.ok(screen.getAllByText(/test-context/).length >= 1);
    assert.ok(screen.getByText(/\d+% score/i));
  });

  test("renders without crashing with empty YAML", () => {
    render(
      <ManifestPreview
        manifestYaml=""
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
      />,
    );

    assert.ok(screen.getByText(/generated manifest/i));
  });

  test("switches to Mermaid tab correctly", () => {
    render(
      <ManifestPreview
        manifestYaml={validYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
      />,
    );

    const mermaidTab = screen.getByRole("button", { name: /mermaid/i });
    mermaidTab.click();
    assert.ok(screen.getByText(/mermaid/i));
  });
});
