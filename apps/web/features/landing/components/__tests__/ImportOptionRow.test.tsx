import { describe, it, mock } from "node:test";
import assert from "node:assert";
import React from "react";
import { JSDOM } from "jsdom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportOptionRow } from "../ImportOptionRow";
import { IMPORT_SUB_OPTIONS } from "../../domain/creation-path";

// Setup DOM environment
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.window = dom.window as unknown as Window & typeof globalThis;

// Mock next/navigation with call tracking wrapper
const mockPushState = {
  calls: [] as unknown[][],
};

const mockPush = (...args: unknown[]) => {
  mockPushState.calls.push(args);
};

mock.module(
  "next/navigation",
  () => ({
    useRouter: () => ({ push: mockPush, replace: () => {} }),
  }),
  { __esModule: true },
);

const mockAvailableOption = IMPORT_SUB_OPTIONS[0]; // manifest - available
const mockComingSoonOption = IMPORT_SUB_OPTIONS[2]; // github - not available

describe("ImportOptionRow", () => {
  it("renders available row as button", () => {
    render(<ImportOptionRow option={mockAvailableOption} />);
    const button = screen.getByRole("button");
    assert(button !== null);
  });

  it("shows label for available row", () => {
    render(<ImportOptionRow option={mockAvailableOption} />);
    assert(screen.getByText("Import Manifest") !== null);
  });

  it("shows description for available row", () => {
    render(<ImportOptionRow option={mockAvailableOption} />);
    assert(screen.getByText(/Upload a manifest.yaml file/i) !== null);
  });

  it("renders coming-soon row as div with role=presentation", () => {
    render(<ImportOptionRow option={mockComingSoonOption} />);
    const div = screen.getByRole("presentation");
    assert(div !== null);
  });

  it("coming-soon row is not clickable (no onClick)", () => {
    render(<ImportOptionRow option={mockComingSoonOption} />);
    const div = screen.getByRole("presentation");
    fireEvent.click(div);
    assert.strictEqual(mockPushState.calls.length, 0);
  });

  it("coming-soon row has cursor-not-allowed class", () => {
    render(<ImportOptionRow option={mockComingSoonOption} />);
    const div = screen.getByRole("presentation");
    assert(div.className.includes("cursor-not-allowed"));
  });

  it("shows Coming soon badge for unavailable option", () => {
    render(<ImportOptionRow option={mockComingSoonOption} />);
    assert(screen.getByText("Coming soon") !== null);
  });

  it("clicking available row calls router.push with correct href", () => {
    render(<ImportOptionRow option={mockAvailableOption} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    assert.strictEqual(mockPushState.calls.length, 1);
    assert.strictEqual(mockPushState.calls[0][0], mockAvailableOption.href);
  });
});
