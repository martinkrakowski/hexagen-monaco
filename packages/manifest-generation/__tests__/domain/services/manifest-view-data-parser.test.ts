import { describe, it } from "vitest";
import assert from "node:assert";
import { parseYamlToViewData } from "../../../src/domain/services/manifest-view-data-parser";

const YAML = `system: vellum
scope: "@vellum"
architecture: modular-monolith
bounded_contexts:
  - name: scene-types
    type: shared-kernel
    description: Type-only cross-context contracts.
  - name: split-view
    type: generic
    description: Side-by-side panel.
  - name: scene-orchestration
    type: core
    description: The primary state machine.
  - name: feedback-domain
    type: supporting
    description: Feedback categorisation rules.
`;

describe("parseYamlToViewData context types", () => {
  const view = parseYamlToViewData(YAML);
  const ctx = (name: string) => view.contexts.find((c) => c.name === name)!;

  it("preserves shared-kernel and generic (regression: were coerced to supporting)", () => {
    assert.strictEqual(ctx("scene-types").type, "shared-kernel");
    assert.strictEqual(ctx("split-view").type, "generic");
    assert.strictEqual(ctx("scene-orchestration").type, "core");
    assert.strictEqual(ctx("feedback-domain").type, "supporting");
  });

  it("gives the new types their own color tokens", () => {
    assert.strictEqual(
      ctx("scene-types").colorToken,
      "hsl(var(--manifest-context-shared-kernel))",
    );
    assert.strictEqual(
      ctx("split-view").colorToken,
      "hsl(var(--manifest-context-generic))",
    );
    // shared-kernel must not collapse onto supporting's color anymore.
    assert.notStrictEqual(
      ctx("scene-types").colorToken,
      ctx("feedback-domain").colorToken,
    );
  });

  it("falls back to supporting for an unrecognized type", () => {
    const odd = parseYamlToViewData(
      `system: x\nbounded_contexts:\n  - name: weird\n    type: not-a-real-type\n    description: x\n`,
    );
    assert.strictEqual(
      odd.contexts.find((c) => c.name === "weird")!.type,
      "supporting",
    );
  });
});
