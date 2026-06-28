import { describe, it, vi } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportOptionRow } from "../ImportOptionRow";
import { IMPORT_SUB_OPTIONS } from "../../domain/creation-path";

const mockAvailableOption = IMPORT_SUB_OPTIONS[0]; // "spec" — consolidated import, available
const mockComingSoonOption = IMPORT_SUB_OPTIONS[1]; // github — coming-soon

describe("ImportOptionRow", () => {
  it("renders available row as button", () => {
    const mockPush = vi.fn();
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
    const mockPush = vi.fn();
    render(
      <ImportOptionRow
        option={mockAvailableOption}
        router={{ push: mockPush }}
      />,
    );
    assert(screen.getByText("Import Manifest or Spec") !== null);
  });

  it("shows description for available row", () => {
    const mockPush = vi.fn();
    render(
      <ImportOptionRow
        option={mockAvailableOption}
        router={{ push: mockPush }}
      />,
    );
    assert(screen.getByText(/upload a generated manifest/i) !== null);
  });

  it("renders coming-soon row as div with role=presentation", () => {
    const mockPush = vi.fn();
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
    const mockPush = vi.fn();
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
    const mockPush = vi.fn();
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
    const mockPush = vi.fn();
    render(
      <ImportOptionRow
        option={mockComingSoonOption}
        router={{ push: mockPush }}
      />,
    );
    assert(screen.getByText("Coming soon") !== null);
  });

  it("clicking available row calls router.push with correct href", () => {
    const mockPush = vi.fn();
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
