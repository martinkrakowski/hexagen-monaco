import React from "react";
import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import { render, screen, cleanup } from "@testing-library/react";
import { ManifestPreview } from "../ManifestPreview";

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
