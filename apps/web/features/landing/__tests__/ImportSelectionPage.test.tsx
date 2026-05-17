import { describe, it, mock } from "node:test";
import assert from "node:assert";
import React from "react";
import { JSDOM } from "jsdom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportSelectionPage } from "../ImportSelectionPage";

// Setup DOM environment
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.window = dom.window as unknown as Window & typeof globalThis;

// Mock next/navigation
mock.module(
  "next/navigation",
  () => ({
    useRouter: () => ({ push: () => {}, replace: () => {} }),
  }),
  { __esModule: true },
);

describe("ImportSelectionPage", () => {
  it("renders three ImportOptionRow instances", () => {
    render(<ImportSelectionPage />);
    const buttons = screen.queryAllByRole("button");
    const presentations = screen.queryAllByRole("presentation");
    assert.ok(buttons.length + presentations.length === 3);
  });

  it("shows Choose Import Type heading", () => {
    render(<ImportSelectionPage />);
    assert.match(document.body.textContent || "", /Choose Import Type/);
  });

  it("shows CreationStepIndicator", () => {
    render(<ImportSelectionPage />);
    assert.ok(screen.getByText("Method"));
  });

  it("back button navigates to /projects/new", () => {
    const mockPushState = { calls: [] as unknown[][] };
    const mockPush = (...args: unknown[]) => {
      mockPushState.calls.push(args);
    };
    mock.module(
      "next/navigation",
      () => ({
        useRouter: () => ({ push: mockPush }),
      }),
      { __esModule: true },
    );
    render(<ImportSelectionPage />);
    const backButton = screen.getByRole("button", { name: /back/i });
    fireEvent.click(backButton);
    assert.strictEqual(mockPushState.calls.length, 1);
    assert.strictEqual(mockPushState.calls[0][0], "/projects/new");
  });
});
