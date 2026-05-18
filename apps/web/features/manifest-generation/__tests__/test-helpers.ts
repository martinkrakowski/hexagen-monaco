/**
 * Test helpers for manifest generation tests
 * Provides stubs and mocks for testing without full DI setup
 */

/**
 * Stub implementation that allows tests to run without full DI
 * Returns minimal working objects for the manifest generation flow
 */
export function createStubManifestGenerationUseCase() {
  return {
    generateTopology: async (
      _params: { description: string },
      _signal?: AbortSignal,
      setStepDetail?: (detail: string) => void,
    ) => {
      setStepDetail?.("Analyzing project structure...");
      return {
        ok: true as const,
        topology: {
          workspace: { name: "test-workspace" },
          boundedContexts: [
            {
              name: "TestContext",
              type: "core" as const,
              inboundPorts: [],
              outboundPorts: [],
            },
          ],
        },
      };
    },
    checkClarificationTriggers: () => [],
    extractAdapters: async () => ({
      ok: true as const,
      adapters: [],
    }),
    renderManifest: async () => ({
      ok: true as const,
      yaml: "workspace:\n  name: test-workspace\nboundedContexts:\n  - name: TestContext\n",
      diagnostics: [],
      token: "test-token",
    }),
  };
}
