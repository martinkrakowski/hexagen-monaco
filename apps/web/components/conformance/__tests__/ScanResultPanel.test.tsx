import { describe, it } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ScanResultPanel } from "../ScanResultPanel";

describe("ScanResultPanel", () => {
  it("renders a pass verdict with layout excerpt", () => {
    render(
      <ScanResultPanel
        verdict="pass"
        exitCode={0}
        layoutExcerpt="contexts:\n  demo:\n    root: packages/demo\n"
        filesScanned={12}
        reportMarkdown={null}
        errorMessage={null}
      />,
    );
    assert.ok(screen.getByText("Scan passed"));
    assert.ok(screen.getByText("Pass"));
    assert.match(document.body.textContent || "", /12 files scanned/);
    assert.match(document.body.textContent || "", /contexts:/);
  });

  it("renders violations", () => {
    render(
      <ScanResultPanel
        verdict="violations"
        exitCode={1}
        layoutExcerpt={null}
        filesScanned={4}
        reportMarkdown="- Layer Violation\n"
        errorMessage={null}
      />,
    );
    assert.ok(screen.getByText("Scan found violations"));
    assert.match(document.body.textContent || "", /Layer Violation/);
  });

  it("renders could-not-run with the CLI error", () => {
    render(
      <ScanResultPanel
        verdict="could-not-run"
        exitCode={2}
        layoutExcerpt={null}
        filesScanned={null}
        reportMarkdown={null}
        errorMessage="No workspace packages found."
      />,
    );
    assert.ok(screen.getByText("Could not run scan"));
    assert.ok(screen.getByRole("alert"));
    assert.match(
      document.body.textContent || "",
      /No workspace packages found/,
    );
  });
});
