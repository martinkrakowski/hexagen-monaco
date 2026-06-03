// JSDOM globals must exist before @testing-library/react is imported.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document as unknown as Document;
global.localStorage = dom.window.localStorage;

import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { useProjectGenerationFlow } from "../useProjectGenerationFlow";

// Minimal blank project config (mirrors usePathNavigation.createBlankProjectConfig),
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
  globalThis.fetch = mock.fn(
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
    mock.reset();
  });

  it("sets the active workspace only after the project is persisted", async () => {
    mockGenerateOk();
    const order: string[] = [];
    // Resolve on a later microtask so a missing `await` would let
    // setActiveWorkspace run first.
    const saveProject = mock.fn(async () => {
      await Promise.resolve();
      order.push("save");
      return "proj-1";
    });
    const setActiveWorkspace = mock.fn(() => {
      order.push("setWs");
    });

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: mock.fn(),
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
    const saveProject = mock.fn(async () => null);
    const setActiveWorkspace = mock.fn();

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: mock.fn(),
      }),
    );

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute(config);
    });

    assert.strictEqual(outcome?.kind, "network-error");
    assert.strictEqual(setActiveWorkspace.mock.calls.length, 0);
  });

  it("returns an error when persistence throws", async () => {
    mockGenerateOk();
    const saveProject = mock.fn(async () => {
      throw new Error("IDB corrupted");
    });
    const setActiveWorkspace = mock.fn();

    const { result } = renderHook(() =>
      useProjectGenerationFlow({
        saveProject,
        setActiveWorkspace,
        setEditorSessionId: mock.fn(),
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
