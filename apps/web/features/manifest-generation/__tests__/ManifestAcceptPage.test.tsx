// crypto.randomUUID is used to stamp the provenance turn id (getter-only
// global in Node — stub via vi.stubGlobal).
vi.stubGlobal("crypto", {
  randomUUID: () => "turn-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

// The page under test is a heavy container; stub its presentation-only
// collaborators so the test pins exactly one behavior: the layer array handed
// to saveProject (the ONLY production write site of the produced-manifest
// provenance link — spec item 3).
vi.mock("../ManifestPreview", () => ({
  ManifestPreview: () => <div data-testid="preview" />,
}));
vi.mock("@/landing/ProjectsShellWithFreeTier", () => ({
  ProjectsShellWithFreeTier: ({
    children,
    footer,
    headerContent,
  }: {
    children?: React.ReactNode;
    footer?: React.ReactNode;
    headerContent?: React.ReactNode;
  }) => (
    <div>
      {headerContent}
      {children}
      {footer}
    </div>
  ),
}));
// The page only needs a passing viewData (no validation failures) to enable
// the accept path; parsing real YAML is ManifestPreview's concern, not this
// test's.
vi.mock("@hexagen/manifest-generation", () => ({
  parseYamlToViewData: () => ({
    validationItems: [],
    overallScore: 90,
    system: "Vellum",
    architecture: "hexagonal",
    contexts: [],
  }),
}));

const saveProject = vi.hoisted(() =>
  // Variadic so mock.calls[i][3] (the initialLayers argument) is indexable.
  vi.fn(async (...args: unknown[]) => {
    void args;
    return "project-1";
  }),
);
vi.mock("../../../app/hooks/useSavedProjects", () => ({
  useSavedProjects: () => ({ saveProject, isLoading: false }),
}));

import { ManifestAcceptPage } from "../ManifestAcceptPage";
import { usePendingManifest } from "../store/usePendingManifest";
import {
  clearGenesisFormValues,
  loadGenesisFormValues,
  saveGenesisFormValues,
  seedGenesisFormValues,
} from "../genesis-workbench/genesisProjectSettingsStore";

const YAML = "bounded_contexts:\n  - name: core\n";

function clickButton(name: RegExp) {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    name.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${name}`);
  fireEvent.click(btn as HTMLButtonElement);
}

function approve() {
  clickButton(/Use This Manifest/);
}

describe("ManifestAcceptPage — provenance capture at accept-save", () => {
  beforeEach(() => {
    cleanup();
    saveProject.mockClear();
    usePendingManifest.getState().clear();
  });

  it("stamps the produced-manifest link on the initial layer when an origin spec exists", async () => {
    usePendingManifest
      .getState()
      .set(
        YAML,
        {} as never,
        "Vellum",
        "/projects/new/import/spec",
        "## Grok\n\nthe original spec",
      );
    render(<ManifestAcceptPage />);
    approve();

    await waitFor(() => assert.strictEqual(saveProject.mock.calls.length, 1));
    const [name, , yaml, initialLayers] = saveProject.mock.calls[0] as [
      string,
      unknown,
      string,
      Array<Record<string, unknown>>,
    ];
    assert.strictEqual(name, "Vellum");
    assert.strictEqual(yaml, YAML);
    assert.strictEqual(initialLayers.length, 1);
    const layer = initialLayers[0];
    assert.strictEqual(layer.kind, "brainstorm");
    const link = layer.link as { type: string; at: number };
    assert.strictEqual(link.type, "produced-manifest");
    assert.strictEqual(typeof link.at, "number");
    const turns = layer.turns as Array<Record<string, unknown>>;
    assert.strictEqual(turns[0].content, "## Grok\n\nthe original spec");
    assert.strictEqual(turns[0].author, "Imported");
  });

  it("saves no initial layer (and no link) without an origin spec", async () => {
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/ai", null);
    render(<ManifestAcceptPage />);
    approve();

    await waitFor(() => assert.strictEqual(saveProject.mock.calls.length, 1));
    const initialLayers = saveProject.mock.calls[0][3];
    assert.deepStrictEqual(initialLayers, []);
  });
});

// Plan Workbench C2: the genesis Section A snapshot's END of life. It exists
// to survive the accept screen's Back/Regenerate round trips — so ONLY a
// completed genesis save may drop it, and only for the genesis origin.
describe("ManifestAcceptPage — genesis settings snapshot lifecycle", () => {
  beforeEach(() => {
    cleanup();
    saveProject.mockClear();
    usePendingManifest.getState().clear();
    clearGenesisFormValues();
  });

  function seedSnapshot() {
    // The null (bypassed-name) seed: the carried-name seed would route
    // through the REAL deriveWorkspaceName, which this suite's
    // @hexagen/manifest-generation mock does not provide — and the lifecycle
    // under test only cares that A snapshot exists under the flow's key.
    const values = seedGenesisFormValues(null);
    values.governance.packageManager = "pnpm";
    saveGenesisFormValues("Vellum", values);
    return values;
  }

  it("a COMPLETED genesis save drops the snapshot — a later fresh genesis flow must not inherit this one's edits", async () => {
    seedSnapshot();
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/ai", null);
    render(<ManifestAcceptPage />);
    approve();

    await waitFor(() => assert.strictEqual(saveProject.mock.calls.length, 1));
    await waitFor(() =>
      assert.strictEqual(loadGenesisFormValues("Vellum"), null),
    );
  });

  it("Back KEEPS the snapshot — surviving the abandoned-accept round trip is the store's purpose", () => {
    const values = seedSnapshot();
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/ai", null);
    render(<ManifestAcceptPage />);
    clickButton(/^Back$/);

    assert.strictEqual(saveProject.mock.calls.length, 0);
    assert.strictEqual(loadGenesisFormValues("Vellum"), values);
  });

  it("Regenerate KEEPS the snapshot for the same reason", () => {
    const values = seedSnapshot();
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/ai", null);
    render(<ManifestAcceptPage />);
    clickButton(/^Regenerate$/);

    assert.strictEqual(loadGenesisFormValues("Vellum"), values);
  });

  it("an IMPORT-flow save leaves an unrelated genesis snapshot alone (the clear is gated on the genesis originPath)", async () => {
    const values = seedSnapshot();
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Imported", "/projects/new/import/spec", null);
    render(<ManifestAcceptPage />);
    approve();

    await waitFor(() => assert.strictEqual(saveProject.mock.calls.length, 1));
    assert.strictEqual(loadGenesisFormValues("Vellum"), values);
  });
});
