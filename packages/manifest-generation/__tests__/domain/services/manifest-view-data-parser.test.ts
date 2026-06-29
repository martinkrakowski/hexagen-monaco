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

describe("Minimum Interface Contract — shared-kernel exemption", () => {
  // A port-less shared-kernel alongside a fully-wired core context: the contract
  // must PASS (the shared-kernel is type-only and exempt), so the deterministic
  // fixer never re-synthesizes ports for it (the accept-view fix-apply loop).
  const YAML = `bounded_contexts:
  - name: scene-types
    type: shared-kernel
    description: Type-only contracts.
  - name: orders
    type: core
    description: Orders.
    layers:
      application:
        ports:
          in: [PlaceOrderPort]
          out: [OrderRepositoryPort]
      infrastructure:
        adapters: [OrderRepositoryAdapter]
`;
  const view = parseYamlToViewData(YAML);
  const contract = view.validationItems.find(
    (v) => v.title === "Minimum Interface Contract",
  )!;

  it("passes when the only port-less context is a shared-kernel", () => {
    assert.strictEqual(contract.status, "pass");
  });

  it("leaves the purged shared-kernel healthy (no error/warning)", () => {
    const sk = view.contexts.find((c) => c.name === "scene-types")!;
    assert.strictEqual(sk.health, "healthy");
    assert.strictEqual(sk.portsIn.length, 0);
    assert.strictEqual(sk.portsOut.length, 0);
  });

  it("still warns when a NON-shared-kernel context is missing ports", () => {
    const v = parseYamlToViewData(
      `bounded_contexts:\n  - name: scene-types\n    type: shared-kernel\n    description: t\n  - name: orders\n    type: core\n    description: o\n`,
    ).validationItems.find((i) => i.title === "Minimum Interface Contract")!;
    assert.strictEqual(v.status, "warn");
  });
});
