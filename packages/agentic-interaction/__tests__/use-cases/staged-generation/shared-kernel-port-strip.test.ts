import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  parseStructuredConfig,
  buildPreDefinedPortMap,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";

/**
 * Regression: importing a manifest where a shared-kernel context already carries
 * ports/adapters used to flow those through `buildPreDefinedPortMap` (filtered
 * only by "has ports", not by type), so the assembled manifest contradicted
 * itself — a "type-only" shared-kernel that still owned SceneTypesCommandPort +
 * a repository adapter. R09 forbids that; the pre-defined merge now drops them.
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
  "  - name: scene-orchestration",
  "    type: core",
  "    description: The primary state machine.",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [UserActionCommandPort]",
  "          out: [MachineContextRepositoryPort]",
  "",
].join("\n");

describe("buildPreDefinedPortMap shared-kernel handling", () => {
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

  it("tolerates the shared_kernel underscore spelling", () => {
    const cfg = CONFIG.replace("shared-kernel", "shared_kernel");
    const portMap = buildPreDefinedPortMap(parseStructuredConfig(cfg));
    assert.ok(
      !portMap.contexts.some((c) => c.contextName === "scene-types"),
      "the shared_kernel dialect spelling is stripped too",
    );
  });
});
