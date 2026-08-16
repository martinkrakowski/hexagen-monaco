// The ZIP export flow had no test of its own while it lived inside the
// 697-line ExportProvider. These pin the two things GOD-004 / REA-005 moved:
// the request payload (which now comes from the shared
// `resolveImportedManifestPayload`) and the fail-closed arm, which must abort
// rather than fall back to the route's degraded `wizardToManifest` projection
// — that fallback IS the data-loss path import round-trip integrity removed.

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, act, waitFor, cleanup } from "@testing-library/react";

import { IMPORTED_MANIFEST_CORRUPT_MESSAGE } from "@/lib/imported-manifest";
import { ExportProvider } from "../ExportContext";
import { useZipExport, type ZipExportContextValue } from "../ZipExportContext";

const harness = vi.hoisted(() => {
  const state = {
    projects: [] as Array<Record<string, unknown>>,
    loadCalls: 0,
    /** The live workspace snapshot the provider reads (wizard vs imported). */
    wizardData: undefined as Record<string, unknown> | undefined,
  };
  const port = {
    loadProjects: async () => {
      state.loadCalls += 1;
      return { success: true as const, value: state.projects };
    },
    saveProjects: async () => ({ success: true as const, value: undefined }),
    updateProjectRecord: async () => ({
      success: true as const,
      value: {} as Record<string, unknown>,
    }),
  };
  const postForBlob = vi.fn();
  const downloadBlob = vi.fn();
  return { state, port, postForBlob, downloadBlob };
});

vi.mock("@/lib/wire.client", () => ({
  getSavedProjectsPersistence: () => harness.port,
  getEditorWorkspacePersistence: () => ({
    loadWorkspace: async () => ({ success: true as const, value: null }),
  }),
  getLogger: () => ({
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  }),
}));
vi.mock("@/lib/fetch-json", () => ({
  postJson: vi.fn(),
  postForBlob: harness.postForBlob,
}));
// The blob/anchor plumbing is DOM detail, not the policy under test.
vi.mock("@/lib/download-blob", () => ({
  downloadBlob: harness.downloadBlob,
}));
vi.mock("@/contexts/ActiveWorkspaceContext", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: {
      projectId: "p1",
      name: "Vellum",
      isDirty: false,
      lastModifiedAt: 0,
      wizardData: harness.state.wizardData,
    },
    setActiveWorkspace: vi.fn(),
    clearActiveWorkspace: vi.fn(),
  }),
}));
vi.mock("@/contexts/ExternalIntegrationContext", () => ({
  useExternalIntegration: () => ({ isAuthenticated: true, signIn: vi.fn() }),
}));

const VALID_MANIFEST_YAML = [
  "system: shop",
  "bounded_contexts:",
  "  - name: billing",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [ProcessPaymentPort]",
  "          out: [PaymentGatewayPort]",
].join("\n");

let ctx: ZipExportContextValue;
function Capture() {
  ctx = useZipExport();
  return null;
}

async function renderProvider() {
  render(
    <ExportProvider>
      <Capture />
    </ExportProvider>,
  );
  await waitFor(() => {
    assert.ok(harness.state.loadCalls >= 1, "mount load ran");
  });
}

describe("ZipExportContext — imported-manifest policy on the export payload", () => {
  beforeEach(() => {
    harness.state.loadCalls = 0;
    harness.state.wizardData = undefined;
    harness.postForBlob.mockReset();
    harness.downloadBlob.mockReset();
    harness.downloadBlob.mockReturnValue({ success: true });
    harness.postForBlob.mockResolvedValue({
      kind: "success",
      data: new Blob(["zip"]),
      notices: undefined,
    });
  });
  afterEach(cleanup);

  it("an IMPORTED project sends the parsed saved manifest alongside wizardData", async () => {
    harness.state.wizardData = { manifestSource: "imported" };
    harness.state.projects = [
      {
        id: "p1",
        name: "Vellum",
        formState: { manifestSource: "imported" },
        manifestYaml: VALID_MANIFEST_YAML,
      },
    ];
    await renderProvider();
    await waitFor(() => {
      assert.ok(harness.state.loadCalls >= 1);
    });

    await act(async () => {
      await ctx.exportZip();
    });

    assert.strictEqual(harness.postForBlob.mock.calls.length, 1);
    const [url, body] = harness.postForBlob.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    assert.strictEqual(url, "/api/export/zip");
    const manifest = body.manifest as { system: string } | undefined;
    assert.ok(manifest, "the saved manifest rides along");
    assert.strictEqual(manifest.system, "shop");
    // wizardData is still sent — the route reads addOnsAnswers from it.
    assert.ok(body.wizardData, "wizardData still sent");
    assert.strictEqual(ctx.state.kind, "success");
  });

  it("a WIZARD-authored project sends no `manifest` field at all", async () => {
    harness.state.wizardData = { governance: { workspaceName: "Vellum" } };
    harness.state.projects = [{ id: "p1", name: "Vellum", formState: {} }];
    await renderProvider();

    await act(async () => {
      await ctx.exportZip();
    });

    const [, body] = harness.postForBlob.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    assert.ok(
      !("manifest" in body),
      "the wizard path must stay byte-identical (no manifest key)",
    );
  });

  it("an IMPORTED project with a corrupt manifest FAILS CLOSED — no request at all", async () => {
    harness.state.wizardData = { manifestSource: "imported" };
    harness.state.projects = [
      {
        id: "p1",
        name: "Vellum",
        formState: { manifestSource: "imported" },
        manifestYaml: "system: [unclosed",
      },
    ];
    await renderProvider();
    await waitFor(() => {
      assert.ok(harness.state.loadCalls >= 1);
    });

    await act(async () => {
      await ctx.exportZip();
    });

    assert.strictEqual(
      harness.postForBlob.mock.calls.length,
      0,
      "a corrupt manifest must never reach the route's degraded fallback",
    );
    const state = ctx.state;
    assert.ok(state.kind === "error", "state is error");
    assert.strictEqual(state.message, IMPORTED_MANIFEST_CORRUPT_MESSAGE);
  });
});
