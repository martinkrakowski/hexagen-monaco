import { describe, it, mock } from "node:test";
import assert from "node:assert";
import React from "react";
import { JSDOM } from "jsdom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportManifestPage } from "../ImportManifestPage";

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

// Mock useSavedProjects
mock.module(
  "../../app/hooks/useSavedProjects",
  () => ({
    useSavedProjects: () => ({ saveProject: () => {} }),
  }),
  { __esModule: true },
);

// Mock useManifestParser
mock.module(
  "./useManifestParser",
  () => ({
    useManifestParser: () => ({
      parseManifest: () => {},
      result: null,
      error: null,
    }),
  }),
  { __esModule: true },
);

describe("ImportManifestPage", () => {
  it("cancel with no file navigates to /projects/new/import", () => {
    render(<ImportManifestPage />);
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);
    assert.strictEqual(mockPushState.calls.length, 1);
    assert.strictEqual(mockPushState.calls[0][0], "/projects/new/import");
  });

  it("cancel with file loaded clears state (shows upload form)", () => {
    // Override useManifestParser to return a non-null result to simulate file loaded
    mock.module(
      "./useManifestParser",
      () => ({
        useManifestParser: () => ({
          parseManifest: () => {},
          result: { governance: { workspaceName: "Test" } },
          error: null,
        }),
      }),
      { __esModule: true },
    );

    render(<ImportManifestPage />);
    // After file loaded, cancel should clear manifestYaml (show upload form again)
    const cancelButton = screen.getByRole("button", {
      name: /back to upload/i,
    });
    fireEvent.click(cancelButton);
    // After cancel, the upload form should be visible (manifestYaml is null)
    assert.ok(screen.getByText(/upload manifest yaml file/i));
  });
});
