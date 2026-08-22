import { describe, it, vi } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportSelectionPage } from "../ImportSelectionPage";

describe("ImportSelectionPage", () => {
  it("renders the consolidated import option rows", () => {
    const mockPush = vi.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    // Assert the options by label — a role count is fragile because the page
    // chrome also renders a Back button. The former manifest + spec options are
    // now a single "Import Manifest or Spec" row (auto-detected on upload).
    assert.ok(screen.getByText("Import Manifest or Spec"));
    assert.ok(screen.getByText("Scan existing project"));
    // Renamed in BF-5.3: the old label promised an OAuth "import", but what
    // shipped is an anonymous shallow clone of a PUBLIC repo. The label has to
    // say public, because the privacy difference is the whole point.
    assert.ok(screen.getByText("Scan a public GitHub repository"));
  });

  it("shows Choose Import Type heading", () => {
    const mockPush = vi.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    assert.match(document.body.textContent || "", /Choose Import Type/);
  });

  it("shows CreationStepIndicator", () => {
    const mockPush = vi.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    assert.ok(screen.getByText("Method"));
  });

  it("back button navigates to /projects/new", () => {
    const mockPush = vi.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    const backButton = screen.getByRole("button", { name: /back/i });
    fireEvent.click(backButton);
    assert.strictEqual(mockPush.mock.calls.length, 1);
    assert.strictEqual(mockPush.mock.calls[0][0], "/projects/new");
  });
});
