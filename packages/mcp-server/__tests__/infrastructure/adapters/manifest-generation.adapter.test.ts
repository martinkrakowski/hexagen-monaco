import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { OpenAIManifestGenerationAdapter } from "../../../src/infrastructure/adapters/manifest-generation.adapter.js";
import type {
  ManifestWritePort,
  RegisterBoundedContextCommand,
} from "../../../src/application/ports/out/manifest-write.port.js";

/**
 * Spy ManifestWritePort — records registerBoundedContext calls; the other
 * methods are unreachable from generateManifestPipeline.
 */
function createWritePortSpy() {
  const registered: RegisterBoundedContextCommand[] = [];
  const port: ManifestWritePort = {
    validateDependency: async () => ({
      success: true,
      value: { valid: true, errors: [] },
    }),
    addDependency: async () => ({ success: true, value: { updated: true } }),
    registerBoundedContext: async (command) => {
      registered.push(command);
      return {
        success: true,
        value: { registered: true, alreadyExisted: false },
      };
    },
    registerPort: async () => ({ success: true, value: { registered: true } }),
    registerAdapter: async () => ({
      success: true,
      value: { registered: true },
    }),
    removePort: async () => ({ success: true, value: { removed: true } }),
    removeContext: async () => ({ success: true, value: { removed: true } }),
  };
  return { port, registered };
}

/** Stubs global fetch to return a fixed chat-completion payload. */
function stubLLMResponse(content: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function topologyDraft(opts: { dependsOn?: string[] }) {
  return {
    workspace: { name: "shop", description: "test workspace" },
    boundedContexts: [
      {
        name: "billing",
        type: "core",
        description: "Billing context",
        // No ports → enrichWithAdapters skips the adapter LLM call entirely,
        // so a single stubbed topology response drives the whole pipeline.
        ports: { in: [], out: [] },
        ...(opts.dependsOn ? { dependsOn: opts.dependsOn } : {}),
      },
    ],
  };
}

describe("manifest generation adapter — pipeline governance gate", () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("should refuse manifest registration when the draft has validation diagnostics", async () => {
    // dependsOn references a context that does not exist → validateDraft
    // emits depends-on-unknown-context.
    restoreFetch = stubLLMResponse(
      topologyDraft({ dependsOn: ["ghost-context"] }),
    );
    const { port, registered } = createWritePortSpy();
    const adapter = new OpenAIManifestGenerationAdapter(
      { apiKey: "test-key" },
      port,
    );

    const result = await adapter.generateManifestPipeline({
      description: "an online shop",
    });

    assert.strictEqual(result.registeredInManifest, false);
    assert.ok(
      result.diagnostics.some((d) => d.code === "depends-on-unknown-context"),
    );
    assert.strictEqual(registered.length, 0);
    // The draft is still returned so the caller can repair and re-run.
    assert.ok(result.yaml.includes("billing"));
  });

  it("should register contexts when the draft validates cleanly", async () => {
    restoreFetch = stubLLMResponse(topologyDraft({}));
    const { port, registered } = createWritePortSpy();
    const adapter = new OpenAIManifestGenerationAdapter(
      { apiKey: "test-key" },
      port,
    );

    const result = await adapter.generateManifestPipeline({
      description: "an online shop",
    });

    assert.strictEqual(result.registeredInManifest, true);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].name, "billing");
  });
});
