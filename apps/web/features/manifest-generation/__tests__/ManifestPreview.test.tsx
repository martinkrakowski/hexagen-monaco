import React from "react";
import { test, describe, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ManifestPreview } from "../ManifestPreview";

// The desktop YAML column is now a react-resizable-panels `PanelGroup`, which
// can't mount under this repo's jsdom (its resize-handle registration trips a
// jsdom addEventListener/AbortSignal incompatibility). The panel layout + the
// resize handle are desktop-only, so force the mobile (non-panel) branch here to
// keep these render/interaction tests isolated; the desktop resizable column and
// its drag handle are verified manually.
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 600,
  });
});
afterEach(cleanup);

describe("ManifestPreview", () => {
  const validYaml = `bounded_contexts:
  - name: test-context
    aggregates:
      - name: test-aggregate
        root: true
`;

  test("renders YAML preview correctly with valid manifest", () => {
    render(
      <ManifestPreview
        manifestYaml={validYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
      />,
    );

    assert.ok(screen.getByText(/generated manifest/i));
    assert.ok(screen.getAllByText(/test-context/).length >= 1);
    assert.ok(screen.getByText(/\d+% score/i));
  });

  test("renders without crashing with empty YAML", () => {
    render(
      <ManifestPreview
        manifestYaml=""
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
      />,
    );

    assert.ok(screen.getByText(/generated manifest/i));
  });

  test("switches to Mermaid tab correctly", () => {
    render(
      <ManifestPreview
        manifestYaml={validYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
      />,
    );

    const mermaidTab = screen.getByRole("button", { name: /mermaid/i });
    mermaidTab.click();
    assert.ok(screen.getByText(/mermaid/i));
  });
});

// Import round-trip integrity, Item 3: the auto-fixer is gated on the server
// report, the approve gate is re-keyed, and any fixer run is disclosed.
describe("ManifestPreview — server validation report gating", () => {
  // Alvaro-class name-only dialect: `StorageProxyPort` has no adapter the
  // parser's name matching can see, so WITHOUT a server report this yields a
  // "files: 1 Unconnected Ports" FAIL and the fixer pads `StorageProxyAdapter`.
  const alvaroDialectYaml = `system: alvaro
scope: "@alvaro"
architecture: modular-monolith
bounded_contexts:
  - name: files
    type: core
    description: File storage.
    layers:
      application:
        ports:
          in: [StoreFilePort]
          out: [StoragePort, StorageProxyPort]
      infrastructure:
        adapters: [StorageAdapter]
`;

  const passingReport = {
    errors: [],
    warnings: ["Consider narrowing StoragePort to a single responsibility."],
    passed: true,
  };

  const approveButton = () =>
    screen.getByRole("button", {
      name: /use this manifest/i,
    }) as HTMLButtonElement;
  const openValidationTab = () =>
    fireEvent.click(screen.getByRole("button", { name: /validation/i }));

  test("report present: the manifest is NOT mutated and approve is enabled despite connectivity heuristics", () => {
    const onYamlChange = vi.fn();
    render(
      <ManifestPreview
        manifestYaml={alvaroDialectYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
        onYamlChange={onYamlChange}
        validationReport={passingReport}
      />,
    );

    // The auto-fix loop was skipped: no padded-adapter commit back to the
    // store (previously this fired with a synthesized `StorageProxyAdapter`).
    assert.strictEqual(onYamlChange.mock.calls.length, 0);
    // The connectivity FAIL is advisory now — the server validated the
    // declared bindings — so approve must not be bricked.
    assert.strictEqual(approveButton().disabled, false);
  });

  test("report present: the Validation tab renders the SERVER findings and downgrades connectivity items to advisory", () => {
    render(
      <ManifestPreview
        manifestYaml={alvaroDialectYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
        validationReport={passingReport}
      />,
    );
    openValidationTab();

    // Server report (ValidationFindingsPanel): the Stage-6 suggestion.
    assert.ok(screen.getByText(/1 suggestion from the review/i));
    assert.ok(screen.getByText(/Consider narrowing StoragePort/));
    // The parser's connectivity item is displayed as advisory, so the
    // "Cannot Approve" summary (fail count > 0) must be gone.
    assert.ok(screen.getByText(/Advisory only: the server pipeline validated/));
    assert.strictEqual(screen.queryByText(/cannot approve/i), null);
  });

  test("report present but passed=false: approve stays blocked", () => {
    render(
      <ManifestPreview
        manifestYaml={alvaroDialectYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
        validationReport={{
          errors: ["[R02] Context 'files' has no inbound port."],
          warnings: [],
          passed: false,
        }}
      />,
    );

    assert.strictEqual(approveButton().disabled, true);
  });

  test("report present but the YAML no longer parses: approve stays blocked", () => {
    render(
      <ManifestPreview
        manifestYaml={"bounded_contexts: [unclosed"}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
        validationReport={passingReport}
      />,
    );

    assert.strictEqual(approveButton().disabled, true);
  });

  test("report absent: the fixer still runs (legacy/hand-written YAML) and its adjustments are DISCLOSED", () => {
    const onYamlChange = vi.fn();
    render(
      <ManifestPreview
        manifestYaml={alvaroDialectYaml}
        onApprove={() => {}}
        onRegenerate={() => {}}
        onStartOver={() => {}}
        onYamlChange={onYamlChange}
      />,
    );

    // The loop ran and committed the padded YAML (the pre-existing report-less
    // contract — the fixer is the only validation there is on this path).
    assert.strictEqual(onYamlChange.mock.calls.length, 1);
    const patched = onYamlChange.mock.calls[0][0] as string;
    assert.match(patched, /StorageProxyAdapter/);

    // ...but no longer silently: the Validation tab lists what was adjusted.
    openValidationTab();
    assert.ok(
      screen.getByText(/1 automatic adjustment was applied/i),
      "disclosure banner renders",
    );
    assert.ok(screen.getByText(/• files: 1 Unconnected Ports/));
    // Post-fix the manifest parses clean, so approve is enabled.
    assert.strictEqual(approveButton().disabled, false);
  });
});
