// crypto.randomUUID is used to stamp the provenance turn id (getter-only
// global in Node — stub via vi.stubGlobal).
vi.stubGlobal("crypto", {
  randomUUID: () => "turn-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import {
  render,
  cleanup,
  fireEvent,
  waitFor,
  screen,
} from "@testing-library/react";

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
// The page only needs a controllable viewData to drive the accept gate;
// parsing real YAML is ManifestPreview's concern, not this test's. Default is
// a passing viewData (no validation failures); the server-report gate tests
// below swap in connectivity failures via the hoisted holder. Passthrough for
// everything else: the genesis settings store's save() seeds its diff
// baseline through the REAL deriveWorkspaceName.
const mockViewData = vi.hoisted(() => {
  const defaults = () => ({
    validationItems: [] as Array<{
      status: "pass" | "warn" | "fail";
      title: string;
      description: string;
    }>,
    overallScore: 90,
    system: "Vellum",
    architecture: "hexagonal",
    contexts: [],
  });
  return { current: defaults(), defaults };
});
vi.mock("@hexagen/manifest-generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hexagen/manifest-generation")>()),
  parseYamlToViewData: () => mockViewData.current,
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
    mockViewData.current = mockViewData.defaults();
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
    mockViewData.current = mockViewData.defaults();
  });

  function seedSnapshot() {
    // The null (bypassed-name) seed VALUES under the "Vellum" key — the
    // lifecycle under test only cares that A snapshot exists under the
    // flow's key. (save() itself seeds its diff baseline through the real
    // deriveWorkspaceName — the manifest-generation mock passes it through.)
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

  it("a FAILED genesis save KEEPS the snapshot — the clear happens only after a truthy projectId, so the Back retry path still finds the edits", async () => {
    const values = seedSnapshot();
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/ai", null);
    // saveProject resolves null: the !projectId arm — the page must stay on
    // accept with the retry message, and the snapshot must survive (a clear
    // hoisted above the await, moved into finally, or wired into this arm
    // would wipe the user's Section A edits on a failed save).
    saveProject.mockResolvedValueOnce(null as never);
    render(<ManifestAcceptPage />);
    approve();

    await waitFor(() => assert.strictEqual(saveProject.mock.calls.length, 1));
    await waitFor(() =>
      assert.ok(
        screen.getByText("Failed to create project. Please try again."),
      ),
    );
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

// Import round-trip integrity, Item 3.3: the footer's approve gate must not
// dead-end on the parser's connectivity heuristics when the store carries the
// server's own validation report for this manifest.
describe("ManifestAcceptPage — server-report approve gate", () => {
  const connectivityFail = {
    status: "fail" as const,
    title: "files: 1 Unconnected Ports",
    description: "Missing adapters for: 'StorageProxyPort'.",
  };

  const approveBtn = () =>
    Array.from(document.querySelectorAll("button")).find((b) =>
      /Use This Manifest/.test(b.textContent || ""),
    ) as HTMLButtonElement;

  beforeEach(() => {
    cleanup();
    saveProject.mockClear();
    usePendingManifest.getState().clear();
    mockViewData.current = mockViewData.defaults();
  });

  it("a connectivity FAIL blocks approve on report-less YAML (heuristics are the only validation there)", () => {
    mockViewData.current.validationItems = [connectivityFail];
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/import/spec", null);
    render(<ManifestAcceptPage />);

    assert.strictEqual(approveBtn().disabled, true);
  });

  it("with a passing server report the same FAIL is advisory: approve is enabled and saves", async () => {
    mockViewData.current.validationItems = [connectivityFail];
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/import/spec", null, {
        errors: [],
        warnings: [],
        passed: true,
      });
    render(<ManifestAcceptPage />);

    assert.strictEqual(approveBtn().disabled, false);
    approve();
    await waitFor(() => assert.strictEqual(saveProject.mock.calls.length, 1));
  });

  it("a FAILED server report still blocks approve", () => {
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/import/spec", null, {
        errors: ["[R02] Context 'files' has no inbound port."],
        warnings: [],
        passed: false,
      });
    render(<ManifestAcceptPage />);

    assert.strictEqual(approveBtn().disabled, true);
  });

  it("Invalid YAML blocks approve even with a passing report (the report vouches for parseable YAML only)", () => {
    mockViewData.current.validationItems = [
      {
        status: "fail",
        title: "Invalid YAML",
        description: "Failed to parse YAML document.",
      },
    ];
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/import/spec", null, {
        errors: [],
        warnings: [],
        passed: true,
      });
    render(<ManifestAcceptPage />);

    assert.strictEqual(approveBtn().disabled, true);
  });
});

// Part B-lite early-continue provenance: validationPending is set only when
// the user advanced with the Stage-5 manifest while the Stage-6 review was
// still streaming (the stream died with the generation page, so no findings
// exist). The accept view must say so — and must NOT loosen its approve gate.
describe("ManifestAcceptPage — validationPending banner (Part B-lite)", () => {
  const approveBtn = () =>
    Array.from(document.querySelectorAll("button")).find((b) =>
      /Use This Manifest/.test(b.textContent || ""),
    ) as HTMLButtonElement;

  beforeEach(() => {
    cleanup();
    saveProject.mockClear();
    usePendingManifest.getState().clear();
    mockViewData.current = mockViewData.defaults();
  });

  it("shows the skipped-review notice (role=status) and, with clean client checks, approve stays enabled", () => {
    usePendingManifest
      .getState()
      .set(
        YAML,
        {} as never,
        "Vellum",
        "/projects/new/import/spec",
        null,
        null,
        true,
      );
    render(<ManifestAcceptPage />);

    const note = screen.getByText(/validation review was skipped/i);
    assert.ok(note);
    // A polite live region, not an alert — informational provenance.
    assert.ok(note.closest("[role='status']"));
    // b1 fallback: no report exists, so the client parse checks gate approve;
    // the default (passing) viewData leaves it enabled.
    assert.strictEqual(approveBtn().disabled, false);
  });

  it("does NOT bypass the client-side gate: a connectivity FAIL still blocks approve on a pending manifest", () => {
    mockViewData.current.validationItems = [
      {
        status: "fail",
        title: "files: 1 Unconnected Ports",
        description: "Missing adapters for: 'StorageProxyPort'.",
      },
    ];
    usePendingManifest
      .getState()
      .set(
        YAML,
        {} as never,
        "Vellum",
        "/projects/new/import/spec",
        null,
        null,
        true,
      );
    render(<ManifestAcceptPage />);

    assert.ok(screen.getByText(/validation review was skipped/i));
    assert.strictEqual(approveBtn().disabled, true);
  });

  it("absent when validation completed normally (flag unset)", () => {
    usePendingManifest
      .getState()
      .set(YAML, {} as never, "Vellum", "/projects/new/import/spec", null, {
        errors: [],
        warnings: [],
        passed: true,
      });
    render(<ManifestAcceptPage />);

    assert.strictEqual(
      screen.queryByText(/validation review was skipped/i),
      null,
    );
  });
});
