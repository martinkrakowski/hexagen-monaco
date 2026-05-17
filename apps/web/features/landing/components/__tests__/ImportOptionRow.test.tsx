import { describe, it } from "node:test";
import assert from "node:assert";
import { jest } from "jest-mock";
import React from "react";
import { JSDOM } from "jsdom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportOptionRow } from "../ImportOptionRow";
import { IMPORT_SUB_OPTIONS } from "../../domain/creation-path";

// Setup DOM environment
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.document = dom.window.document;
(globalThis as unknown as Window & typeof globalThis).window = dom.window;

// TODO: ADR-0038 — Using jest-mock jest.fn() due to Node.js v25 mock.module() restriction
// Once Node.js stabilizes experimental module mocking, migrate back to node:test + mock.module()

const mockAvailableOption = IMPORT_SUB_OPTIONS[0]; // manifest - available
const mockComingSoonOption = IMPORT_SUB_OPTIONS[2]; // github - not available

describe("ImportOptionRow", () => {
  it("renders available row as button", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockAvailableOption}
        router={{ push: mockPush }}
      />,
    );
    const button = screen.getByRole("button");
    assert(button !== null);
  });

  it("shows label for available row", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockAvailableOption}
        router={{ push: mockPush }}
      />,
    );
    assert(screen.getByText("Import Manifest YAML") !== null);
  });

  it("shows description for available row", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockAvailableOption}
        router={{ push: mockPush }}
      />,
    );
    assert(screen.getByText(/Upload an existing manifest/i) !== null);
  });

  it("renders coming-soon row as div with role=presentation", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockComingSoonOption}
        router={{ push: mockPush }}
      />,
    );
    const div = screen.getByRole("presentation");
    assert(div !== null);
  });

  it("coming-soon row is not clickable (no onClick)", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockComingSoonOption}
        router={{ push: mockPush }}
      />,
    );
    const div = screen.getByRole("presentation");
    fireEvent.click(div);
    assert.strictEqual(mockPush.mock.calls.length, 0);
  });

  it("coming-soon row has cursor-not-allowed class", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockComingSoonOption}
        router={{ push: mockPush }}
      />,
    );
    const div = screen.getByRole("presentation");
    assert(div.className.includes("cursor-not-allowed"));
  });

  it("shows Coming soon badge for unavailable option", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockComingSoonOption}
        router={{ push: mockPush }}
      />,
    );
    assert(screen.getByText("Coming soon") !== null);
  });

  it("clicking available row calls router.push with correct href", () => {
    const mockPush = jest.fn();
    render(
      <ImportOptionRow
        option={mockAvailableOption}
        router={{ push: mockPush }}
      />,
    );
    const button = screen.getByRole("button");
    fireEvent.click(button);
    assert.strictEqual(mockPush.mock.calls.length, 1);
    assert.strictEqual(mockPush.mock.calls[0][0], mockAvailableOption.href);
  });
});
