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

describe("outbound port → adapter matching (first-match-wins, no overwrite)", () => {
  // Regression (import round-trip integrity, Item 3.5): the fuzzy
  // cross-containment match let a LATER port re-match an adapter an earlier
  // port had already claimed and overwrite its `implements` — stranding the
  // earlier port as a FAIL the deterministic fixer refuses to touch (its
  // exact-base skip sees the base already present), so approve never unlocked.
  const YAML = `bounded_contexts:
  - name: storage
    type: core
    description: Storage.
    layers:
      application:
        ports:
          in: [StoreFilePort]
          out: [StoragePort, StorageProxyPort]
      infrastructure:
        adapters: [StorageAdapter, StorageProxyAdapter]
`;

  const storageCtx = (yaml: string) =>
    parseYamlToViewData(yaml).contexts.find((c) => c.name === "storage")!;

  it("a later cross-contained port cannot steal an already-claimed adapter", () => {
    const view = parseYamlToViewData(YAML);
    const ctx = view.contexts.find((c) => c.name === "storage")!;
    const byName = (n: string) => ctx.adapters.find((a) => a.name === n)!;
    // Before the fix: StorageProxyPort re-matched StorageAdapter (its base
    // "StorageProxy" contains "Storage") and overwrote implements.
    assert.strictEqual(byName("StorageAdapter").implements, "StoragePort");
    assert.strictEqual(
      byName("StorageProxyAdapter").implements,
      "StorageProxyPort",
    );
    // Both ports connected — no false "Unconnected Ports" FAIL.
    assert.ok(ctx.portsOut.every((p) => !p.hasIssue));
    assert.ok(
      !view.validationItems.some((v) => v.title.includes("Unconnected")),
    );
    assert.strictEqual(ctx.health, "healthy");
  });

  it("exact base match wins even when the ports arrive in reverse order", () => {
    const ctx = storageCtx(
      YAML.replace(
        "[StoragePort, StorageProxyPort]",
        "[StorageProxyPort, StoragePort]",
      ),
    );
    const byName = (n: string) => ctx.adapters.find((a) => a.name === n)!;
    // Without the exact-match preference, StorageProxyPort (processed first)
    // would fuzzy-claim StorageAdapter and force a cross-assignment.
    assert.strictEqual(byName("StorageAdapter").implements, "StoragePort");
    assert.strictEqual(
      byName("StorageProxyAdapter").implements,
      "StorageProxyPort",
    );
  });

  it("a port with no unclaimed adapter left is reported unconnected (the RIGHT port)", () => {
    const view = parseYamlToViewData(
      YAML.replace("[StorageAdapter, StorageProxyAdapter]", "[StorageAdapter]"),
    );
    const ctx = view.contexts.find((c) => c.name === "storage")!;
    // The exact match keeps StorageAdapter with StoragePort; StorageProxyPort
    // (which genuinely has no adapter) is the one flagged — previously the
    // overwrite flagged StoragePort instead.
    assert.strictEqual(ctx.adapters[0].implements, "StoragePort");
    const proxy = ctx.portsOut.find((p) => p.name === "StorageProxyPort")!;
    assert.strictEqual(proxy.hasIssue, true);
    assert.ok(
      view.validationItems.some(
        (v) => v.title.includes("Unconnected") && v.status === "fail",
      ),
    );
  });
});
