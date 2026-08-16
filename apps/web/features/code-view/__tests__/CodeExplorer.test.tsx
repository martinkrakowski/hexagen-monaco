import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { WizardData } from "@hexagen/project-configuration";
import { CodeExplorer, type CodeExplorerProps } from "../explorer/CodeExplorer";
import { CodeView } from "../CodeView";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const wizardData = {
  governance: { workspaceName: "test-ws" },
  boundedContexts: [],
  externalContexts: [],
  peerMappings: [],
  addOnsAnswers: {},
} as unknown as WizardData;

const files = new Map([["src/index.ts", "export const answer = 42;"]]);

function explorerProps(
  overrides: Partial<CodeExplorerProps> = {},
): CodeExplorerProps {
  return {
    files,
    notices: { warnings: [], errors: [] },
    loading: false,
    isDownloading: false,
    isDownloadingArchitecture: false,
    error: null,
    isStale: false,
    onRefresh: () => {},
    onDownloadZip: () => {},
    onDownloadArchitecture: () => {},
    selectedFileId: null,
    editedFiles: new Map(),
    onFileSelect: () => {},
    onFileContentChange: () => {},
    editorSlot: () => <div />,
    ...overrides,
  };
}

describe("code-view explorer boundary (REA-003)", () => {
  it("renders caller-supplied files without performing generation I/O", async () => {
    // No mock of the subject: the explorer is rendered exactly as the app
    // renders it. `fetch` is the outside world, and the assertion is that the
    // explorer never touches it — before the boundary split this render fired
    // POST /api/generate on mount and showed "Ready to generate" instead.
    const fetchSpy = vi.fn(() =>
      Promise.reject(new Error("the explorer must not reach the network")),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<CodeExplorer {...explorerProps()} />);

    // Let any effect-scheduled microtask land before asserting silence.
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("src")).toBeTruthy();
    expect(screen.getByText("index.ts")).toBeTruthy();
  });

  it("raises download and refresh as intents rather than doing them", async () => {
    const onDownloadZip = vi.fn();
    const onDownloadArchitecture = vi.fn();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(
      <CodeExplorer
        {...explorerProps({ onDownloadZip, onDownloadArchitecture })}
      />,
    );

    screen.getByTitle("Download Project (ZIP)").click();
    screen.getByTitle("Download Architecture (.architecture/)").click();

    expect(onDownloadZip).toHaveBeenCalledTimes(1);
    expect(onDownloadArchitecture).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("CodeView still wires generation into the explorer", async () => {
    // The other side of the split: the boundary must keep doing the I/O the
    // explorer gave up. Only the network is stubbed — the hook, the container
    // and the explorer are all the real thing.
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          files: { "src/generated.ts": "export const x = 1;" },
          warnings: [],
          errors: [],
        }),
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(
      <CodeView
        wizardData={wizardData}
        savedManifestYaml={null}
        selectedFileId={null}
        editedFiles={new Map()}
        onFileSelect={() => {}}
        onFileContentChange={() => {}}
        editorSlot={() => <div />}
      />,
    );

    await waitFor(() => expect(screen.getByText("generated.ts")).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
