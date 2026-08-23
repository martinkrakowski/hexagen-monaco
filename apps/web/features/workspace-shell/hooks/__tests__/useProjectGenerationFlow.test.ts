import { describe, it, afterEach, vi } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { IMPORTED_MANIFEST_CORRUPT_MESSAGE } from "@/lib/imported-manifest";
import { useProjectGenerationFlow } from "../useProjectGenerationFlow";

type FlowOptions = Parameters<typeof useProjectGenerationFlow>[0];

// Minimal blank project config (mirrors createDefaultProjectConfig),
// which wizardToManifest accepts.
const config: ProjectConfig = {
  governance: {
    workspaceName: "test-ws",
    workspaceTemplate: "modular-monolith",
    workspaceDescription: undefined,
    packageManager: "yarn",
    topologyStrictness: "flexible",
    namespacePrefix: "@hexagen",
    namingConventions: {
      contextDirectoryPattern: "packages/",
      adapterSuffix: ".adapter.ts",
    },
  },
  boundedContexts: [
    {
      id: "ctx-1",
      name: "core",
      description: "",
      infrastructureTarget: "nestjs",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      entities: [],
      useCases: [],
      portConfiguration: { inboundPorts: [], outboundPorts: [] },
      uiFramework: "",
      persistenceAdapter: "",
      messagingAdapter: "",
      telemetryProvider: "",
    },
  ],
  externalContexts: [],
  peerMappings: [],
  addOnsAnswers: {},
} as unknown as ProjectConfig;

function mockGenerateOk() {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          files: { "manifest.yaml": "system: x\n" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  ) as unknown as typeof fetch;
}

describe("useProjectGenerationFlow", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sets the active workspace only after the project is persisted", async () => {
    mockGenerateOk();
    const order: string[] = [];
    // Resolve on a later microtask so a missing `await` would let
    // setActiveWorkspace run first.
    const saveProject = vi.fn<FlowOptions["saveProject"]>(async () => {
      await Promise.resolve();
      order.push("save");
      return "proj-1";
    });
    const setActiveWorkspace = vi.fn<FlowOptions["setActiveWorkspace"]>(() => {
      order.push("setWs");
    });

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(config);
    });

    assert.strictEqual(outcome?.kind, "success");
    assert.deepStrictEqual(order, ["save", "setWs"]); // persisted before workspace set
    assert.strictEqual(setActiveWorkspace.mock.calls.length, 1);
  });

  it("returns an error and skips the workspace when persistence fails", async () => {
    mockGenerateOk();
    const saveProject = vi.fn<FlowOptions["saveProject"]>(async () => null);
    const setActiveWorkspace = vi.fn();

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(config);
    });

    assert.strictEqual(outcome?.kind, "network-error");
    assert.strictEqual(setActiveWorkspace.mock.calls.length, 0);
  });

  // Import round-trip integrity (Item 1.5): for imported projects the stored
  // manifest — not the lossy wizardToManifest projection — must reach /api/generate.
  it("sends the PARSED saved manifest for an imported project", async () => {
    mockGenerateOk();
    const importedConfig = {
      ...config,
      manifestSource: "imported",
    } as ProjectConfig;
    const savedYaml = [
      "system: shop",
      "bounded_contexts:",
      "  - name: billing",
      "    layers:",
      "      application:",
      "        ports:",
      "          in: [ProcessPaymentPort]",
    ].join("\n");

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject: vi.fn(async () => "proj-1"),
        setActiveWorkspace: vi.fn(),
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(importedConfig, savedYaml);
    });

    assert.strictEqual(outcome?.kind, "success");
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    // The manifest field is the parsed saved manifest (rich architecture),
    // not the wizard projection — "billing" exists nowhere in `config`.
    assert.strictEqual(body.manifest.system, "shop");
    assert.strictEqual(body.manifest.bounded_contexts[0].name, "billing");
  });

  it("persists the ORIGINAL imported YAML, not the server's re-serialization", async () => {
    mockGenerateOk(); // the mocked server emits "system: x\n" — different text
    const importedConfig = {
      ...config,
      manifestSource: "imported",
    } as ProjectConfig;
    // The comment below exists ONLY in the original text — a server YAML
    // round-trip drops comments/formatting, which is exactly what persisting
    // result.files["manifest.yaml"] would bake into the stored record.
    const savedYaml = [
      "# provenance note the server emission would drop",
      "system: shop",
      "bounded_contexts:",
      "  - name: billing",
      "    layers:",
      "      application:",
      "        ports:",
      "          in: [ProcessPaymentPort]",
    ].join("\n");
    const saveProject = vi.fn<FlowOptions["saveProject"]>(async () => "proj-1");
    const setActiveWorkspace = vi.fn();

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(importedConfig, savedYaml);
    });

    assert.ok(outcome?.kind === "success"); // narrows for .manifestYaml below
    // saveProject, the active workspace, and the success outcome all carry the
    // validated ORIGINAL text — not the server's "system: x\n" emission.
    assert.strictEqual(saveProject.mock.calls[0]?.[2], savedYaml);
    assert.strictEqual(
      (setActiveWorkspace.mock.calls[0]?.[0] as { manifestYaml: string })
        .manifestYaml,
      savedYaml,
    );
    assert.strictEqual(outcome.manifestYaml, savedYaml);
  });

  it("fails closed (no fetch) when an imported project's saved manifest is corrupt", async () => {
    mockGenerateOk();
    const importedConfig = {
      ...config,
      manifestSource: "imported",
    } as ProjectConfig;
    const saveProject = vi.fn<FlowOptions["saveProject"]>(async () => "proj-1");

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace: vi.fn(),
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(importedConfig, "a: [unclosed");
    });

    assert.ok(outcome?.kind === "validation-error"); // narrows for .errors below
    assert.ok(outcome.errors.includes(IMPORTED_MANIFEST_CORRUPT_MESSAGE));
    // Fail CLOSED: no degraded generation, no save.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    assert.strictEqual(fetchMock.mock.calls.length, 0);
    assert.strictEqual(saveProject.mock.calls.length, 0);
  });

  it("keeps the wizard projection path when manifestSource is absent (savedManifestYaml ignored)", async () => {
    mockGenerateOk();

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject: vi.fn(async () => "proj-1"),
        setActiveWorkspace: vi.fn(),
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      // Even with a (stale) saved YAML supplied, a wizard-authored config
      // must generate from the live wizardToManifest projection.
      outcome = await result.current.execute(config, "system: stale\n");
    });

    assert.strictEqual(outcome?.kind, "success");
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    assert.notStrictEqual(body.manifest.system, "stale");
    // Search by name — wizardToManifest prepends its emitted shared context.
    assert.ok(
      (body.manifest.bounded_contexts as Array<{ name: string }>).some(
        (c) => c.name === "core",
      ),
    );
  });

  it("returns an error when persistence throws", async () => {
    mockGenerateOk();
    const saveProject = vi.fn<FlowOptions["saveProject"]>(async () => {
      throw new Error("IDB corrupted");
    });
    const setActiveWorkspace = vi.fn();

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: vi.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(config);
    });

    assert.strictEqual(outcome?.kind, "network-error");
    assert.strictEqual(setActiveWorkspace.mock.calls.length, 0);
  });
});
