import { describe, it, vi } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportOptionRow } from "../ImportOptionRow";
import { IMPORT_SUB_OPTIONS } from "../../domain/creation-path";

const mockAvailableOption = IMPORT_SUB_OPTIONS.find((o) => o.id === "spec")!;
// SYNTHETIC, not a real option. This used to be the `github` entry, which
// broke the moment github shipped (BF-5.3): four tests for the component's
// coming-soon rendering path failed, none of which were about github.
//
// A component test should not depend on which features happen to be
// unreleased. The coming-soon path still needs coverage even when nothing
// currently ships in that state -- and if this were rebound to whichever
// option is unreleased today, it would break again on the day that one ships.
const mockComingSoonOption = {
  ...IMPORT_SUB_OPTIONS.find((o) => o.id === "github")!,
  id: "github" as const,
  status: "coming-soon" as const,
};
const mockScanOption = IMPORT_SUB_OPTIONS.find((o) => o.id === "scan")!;

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

  it("scan option is available and navigates to the name step", () => {
    const mockPush = vi.fn();
    render(
      <ImportOptionRow option={mockScanOption} router={{ push: mockPush }} />,
    );
    const button = screen.getByRole("button");
    fireEvent.click(button);
    assert.strictEqual(
      mockPush.mock.calls[0][0],
      "/projects/new/name?path=scan",
    );
  });
});
