import { describe, it, vi } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportSelectionPage } from "../ImportSelectionPage";

describe("ImportSelectionPage", () => {
  it("renders three ImportOptionRow instances", () => {
    const mockPush = vi.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    // Assert the three options by label — a role count is fragile because the
    // page chrome also renders a Back button.
    assert.ok(screen.getByText("Import Manifest YAML"));
    assert.ok(screen.getByText("Import Project Specification"));
    assert.ok(screen.getByText("Import from GitHub"));
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
