import { describe, it } from "node:test";
import assert from "node:assert";
import { jest } from "jest-mock";
import React from "react";
import { JSDOM } from "jsdom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportSelectionPage } from "../ImportSelectionPage";

// Setup DOM environment
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.document = dom.window.document;
(globalThis as unknown as Window & typeof globalThis).window = dom.window;

// TODO: ADR-0038 — Using jest-mock jest.fn() due to Node.js v25 mock.module() restriction
// Once Node.js stabilizes experimental module mocking, migrate back to node:test + mock.module()

describe("ImportSelectionPage", () => {
  it("renders three ImportOptionRow instances", () => {
    const mockPush = jest.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    const buttons = screen.queryAllByRole("button");
    const presentations = screen.queryAllByRole("presentation");
    assert.ok(buttons.length + presentations.length === 3);
  });

  it("shows Choose Import Type heading", () => {
    const mockPush = jest.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    assert.match(document.body.textContent || "", /Choose Import Type/);
  });

  it("shows CreationStepIndicator", () => {
    const mockPush = jest.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    assert.ok(screen.getByText("Method"));
  });

  it("back button navigates to /projects/new", () => {
    const mockPush = jest.fn();
    render(<ImportSelectionPage router={{ push: mockPush }} />);
    const backButton = screen.getByRole("button", { name: /back/i });
    fireEvent.click(backButton);
    assert.strictEqual(mockPush.mock.calls.length, 1);
    assert.strictEqual(mockPush.mock.calls[0][0], "/projects/new");
  });
});
