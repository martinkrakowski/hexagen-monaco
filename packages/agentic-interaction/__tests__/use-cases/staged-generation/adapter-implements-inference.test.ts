import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  parseStructuredConfig,
  buildPreDefinedPortMap,
  buildPreDefinedAdapterBindings,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";

/**
 * Regression: importing a manifest reconstructs each adapter's `implements` port
 * from the adapter NAME (the YAML carries adapters as bare strings). The old
 * heuristic stripped the outbound TYPE WORD (Repository/Notifier/…) from the
 * adapter but not the port, and matched with a greedy bidirectional substring —
 * so an adapter renamed for global uniqueness (R12, `ReviewLifecycle…`) no longer
 * matched its `…RepositoryPort` (phantom R04 "0 adapters"), and
 * `AuditTrailNotifierAdapter` mis-bound to `GetAuditTrailQueryPort` (phantom R05
 * "2 adapters" + R04 on the real port). This pins the corrected, anchored match.
 */
const CONFIG = [
  "bounded_contexts:",
  "  - name: scene-orchestration",
  "    type: core",
  "    description: The primary state machine.",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [ScenePort, PipelinePort]",
  "          out: [MachineContextRepositoryPort, DomainEventPublisherPort, ExternalPipelineClientPort, NotificationDispatcherPort]",
  "      infrastructure:",
  "        adapters: [ScenePortControllerAdapter, PipelinePortControllerAdapter, MachineContextRepositoryAdapter, DomainEventPublisherAdapter, ExternalPipelineClientAdapter, NotificationDispatcherAdapter]",
  "  - name: review-lifecycle",
  "    type: core",
  "    description: Iteration data model.",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [StartIterationCommandPort, CompleteIterationCommandPort, GetAuditTrailQueryPort, SceneConfigResolvedEventPort]",
  "          out: [MachineContextRepositoryPort, IterationCompletedPublisherPort, AuditTrailNotifierPort]",
  "      infrastructure:",
  "        adapters: [StartIterationCommandControllerAdapter, CompleteIterationCommandControllerAdapter, GetAuditTrailQueryControllerAdapter, SceneConfigResolvedEventListenerAdapter, ReviewLifecycleMachineContextRepositoryAdapter, IterationCompletedPublisherAdapter, AuditTrailNotifierAdapter]",
  "",
].join("\n");

const config = parseStructuredConfig(CONFIG);
const bindings = buildPreDefinedAdapterBindings(
  config,
  buildPreDefinedPortMap(config),
);
const implMap = (ctxName: string): Map<string, string> => {
  const ctx = bindings.contexts.find((c) => c.contextName === ctxName)!;
  return new Map(ctx.adapters.map((a) => [a.name, a.implements]));
};

describe("inferAdapterImplements (import-path port↔adapter reconstruction)", () => {
  it("binds an R12-renamed adapter back to its repository port", () => {
    assert.strictEqual(
      implMap("review-lifecycle").get(
        "ReviewLifecycleMachineContextRepositoryAdapter",
      ),
      "MachineContextRepositoryPort",
    );
  });

  it("does NOT mis-bind a Notifier adapter to a Query port (greedy substring)", () => {
    const m = implMap("review-lifecycle");
    assert.strictEqual(
      m.get("AuditTrailNotifierAdapter"),
      "AuditTrailNotifierPort",
    );
    assert.strictEqual(
      m.get("GetAuditTrailQueryControllerAdapter"),
      "GetAuditTrailQueryPort",
    );
  });

  it("handles the `…Port`-retaining inbound adapter shape (ScenePort)", () => {
    const m = implMap("scene-orchestration");
    assert.strictEqual(m.get("ScenePortControllerAdapter"), "ScenePort");
    assert.strictEqual(m.get("PipelinePortControllerAdapter"), "PipelinePort");
    assert.strictEqual(
      m.get("ExternalPipelineClientAdapter"),
      "ExternalPipelineClientPort",
    );
  });

  it("covers every port in each context exactly once (the R04/R05 invariant)", () => {
    for (const ctxName of ["scene-orchestration", "review-lifecycle"]) {
      const ctxPorts = buildPreDefinedPortMap(config).contexts.find(
        (c) => c.contextName === ctxName,
      )!;
      const allPorts = [...ctxPorts.in, ...ctxPorts.out].map((p) => p.name);
      const counts = new Map<string, number>();
      for (const a of bindings.contexts.find((c) => c.contextName === ctxName)!
        .adapters) {
        if (a.implements)
          counts.set(a.implements, (counts.get(a.implements) ?? 0) + 1);
      }
      for (const port of allPorts) {
        assert.strictEqual(
          counts.get(port) ?? 0,
          1,
          `${ctxName}/${port} should have exactly one adapter`,
        );
      }
    }
  });

  it("leaves a genuinely-unmatched adapter unbound rather than misattributing", () => {
    const cfg = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: orders",
        "    type: core",
        "    description: Orders.",
        "    layers:",
        "      application:",
        "        ports:",
        "          in: [PlaceOrderCommandPort]",
        "          out: [OrderRepositoryPort]",
        "      infrastructure:",
        "        adapters: [PlaceOrderCommandControllerAdapter, OrderRepositoryAdapter, TotallyUnrelatedAdapter]",
        "",
      ].join("\n"),
    );
    const m = new Map(
      buildPreDefinedAdapterBindings(cfg, buildPreDefinedPortMap(cfg))
        .contexts.find((c) => c.contextName === "orders")!
        .adapters.map((a) => [a.name, a.implements]),
    );
    assert.strictEqual(m.get("OrderRepositoryAdapter"), "OrderRepositoryPort");
    assert.strictEqual(
      m.get("PlaceOrderCommandControllerAdapter"),
      "PlaceOrderCommandPort",
    );
    assert.strictEqual(m.get("TotallyUnrelatedAdapter"), "");
  });
});
