import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  parseStructuredConfig,
  buildPreDefinedPortMap,
  buildPreDefinedAdapterBindings,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";

/**
 * Regression: importing a manifest where a shared-kernel context already carries
 * ports/adapters used to flow those through the pre-defined merge (filtered only
 * by "has ports/adapters", not by type), so the assembled manifest contradicted
 * itself — a "type-only" shared-kernel that still owned SceneTypesCommandPort +
 * a repository adapter. R09 forbids that; the merge now drops both.
 */
const CONFIG = [
  "bounded_contexts:",
  "  - name: scene-types",
  "    type: shared-kernel",
  "    description: Type-only cross-context contracts.",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [SceneTypesCommandPort]",
  "          out: [SceneTypesRepositoryPort]",
  "      infrastructure:",
  "        adapters: [SceneTypesRepositoryAdapter]",
  "  - name: scene-orchestration",
  "    type: core",
  "    description: The primary state machine.",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [UserActionCommandPort]",
  "          out: [MachineContextRepositoryPort]",
  "      infrastructure:",
  "        adapters: [SceneOrchestrationRepositoryAdapter]",
  "",
].join("\n");

describe("pre-defined merge shared-kernel handling", () => {
  it("strips pre-defined ports from a shared-kernel context (R09)", () => {
    const portMap = buildPreDefinedPortMap(parseStructuredConfig(CONFIG));
    const names = portMap.contexts.map((c) => c.contextName);
    assert.ok(
      !names.includes("scene-types"),
      "shared-kernel scene-types must not carry pre-defined ports",
    );
    assert.ok(
      names.includes("scene-orchestration"),
      "a non-shared-kernel context keeps its pre-defined ports",
    );
  });

  it("strips pre-defined adapters from a shared-kernel context (R09)", () => {
    const config = parseStructuredConfig(CONFIG);
    const adapters = buildPreDefinedAdapterBindings(
      config,
      buildPreDefinedPortMap(config),
    );
    const names = adapters.contexts.map((c) => c.contextName);
    assert.ok(
      !names.includes("scene-types"),
      "shared-kernel scene-types must not carry a pre-defined adapter",
    );
    assert.ok(
      names.includes("scene-orchestration"),
      "a non-shared-kernel context keeps its pre-defined adapter",
    );
  });

  it("tolerates the shared_kernel underscore spelling", () => {
    const cfg = CONFIG.replace("shared-kernel", "shared_kernel");
    const portMap = buildPreDefinedPortMap(parseStructuredConfig(cfg));
    assert.ok(
      !portMap.contexts.some((c) => c.contextName === "scene-types"),
      "the shared_kernel dialect spelling is stripped too",
    );
  });

  it("does not crash on a non-string context type (malformed import)", () => {
    // structured-config parsing doesn't enforce per-field types, so a non-string
    // `type` can reach the filter. It must be treated as not-shared-kernel rather
    // than throw on `.trim()` and abort generation.
    const config = {
      bounded_contexts: [
        {
          name: "weird",
          type: 123,
          layers: { application: { ports: { in: ["WeirdPort"], out: [] } } },
        },
      ],
    } as unknown as Parameters<typeof buildPreDefinedPortMap>[0];
    assert.doesNotThrow(() => buildPreDefinedPortMap(config));
    assert.ok(
      buildPreDefinedPortMap(config).contexts.some(
        (c) => c.contextName === "weird",
      ),
      "a non-string-typed context is not mistaken for a shared-kernel",
    );
  });
});
