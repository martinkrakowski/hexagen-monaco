import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAddOnOverlay,
  type AddOnMeta,
  type AddOnMetaLookup,
  type OverlayContext,
} from "./addon-overlay";

const META: Record<string, AddOnMeta> = {
  bullmq: { provides: "messaging.out-adapter", scope: "context" },
  supabase: { provides: "persistence.out-adapter", scope: "context" },
  "adobe-firefly-generate": {
    provides: "external-integration.out-adapter",
    scope: "context",
  },
  "llm-adapter": { provides: "llm.out-adapter", scope: "context" },
  "shared-types": { provides: "kernel.user-context", scope: "shared" },
  docker: { provides: "platform.container", scope: "project" },
};
const lookup: AddOnMetaLookup = (id) => META[id];

const ctx = (
  id: string,
  fields: Partial<OverlayContext> = {},
): OverlayContext => ({
  id,
  ...fields,
});

describe("computeAddOnOverlay", () => {
  it("annotates the messagingAdapter slot of every context that declares it (context scope, Q1 multi-match)", () => {
    const overlay = computeAddOnOverlay({ bullmq: {} }, lookup, [
      ctx("a", { messagingAdapter: "BullMQ" }),
      ctx("b", { messagingAdapter: "BullMQ" }),
      ctx("c"), // no messagingAdapter → not annotated
    ]);
    assert.deepEqual(overlay, [
      {
        kind: "context-adapter",
        addOnId: "bullmq",
        capability: "messaging.out-adapter",
        contextId: "a",
        field: "messagingAdapter",
      },
      {
        kind: "context-adapter",
        addOnId: "bullmq",
        capability: "messaging.out-adapter",
        contextId: "b",
        field: "messagingAdapter",
      },
    ]);
  });

  it("maps persistence.out-adapter to the persistenceAdapter slot", () => {
    const overlay = computeAddOnOverlay({ supabase: {} }, lookup, [
      ctx("a", { persistenceAdapter: "Drizzle" }),
    ]);
    assert.deepEqual(overlay, [
      {
        kind: "context-adapter",
        addOnId: "supabase",
        capability: "persistence.out-adapter",
        contextId: "a",
        field: "persistenceAdapter",
      },
    ]);
  });

  it("badges a field-mapped add-on in the platform zone when NO context declares the field (no-host fallback)", () => {
    const overlay = computeAddOnOverlay({ bullmq: {} }, lookup, [
      ctx("a"),
      ctx("b"),
    ]);
    assert.deepEqual(overlay, [
      {
        kind: "platform-zone",
        addOnId: "bullmq",
        capability: "messaging.out-adapter",
        reason: "no-host",
      },
    ]);
  });

  it("badges capabilities with no compass field (external-integration / llm) regardless of contexts", () => {
    const overlay = computeAddOnOverlay(
      { "adobe-firefly-generate": {}, "llm-adapter": {} },
      lookup,
      [ctx("a", { messagingAdapter: "BullMQ", persistenceAdapter: "Drizzle" })],
    );
    assert.deepEqual(overlay, [
      {
        kind: "platform-zone",
        addOnId: "adobe-firefly-generate",
        capability: "external-integration.out-adapter",
        reason: "no-compass-field",
      },
      {
        kind: "platform-zone",
        addOnId: "llm-adapter",
        capability: "llm.out-adapter",
        reason: "no-compass-field",
      },
    ]);
  });

  it("maps shared scope to the shared-kernel", () => {
    const overlay = computeAddOnOverlay({ "shared-types": {} }, lookup, []);
    assert.deepEqual(overlay, [
      {
        kind: "shared-kernel",
        addOnId: "shared-types",
        capability: "kernel.user-context",
      },
    ]);
  });

  it("maps project scope to a platform-zone chip", () => {
    const overlay = computeAddOnOverlay({ docker: {} }, lookup, [ctx("a")]);
    assert.deepEqual(overlay, [
      {
        kind: "platform-zone",
        addOnId: "docker",
        capability: "platform.container",
        reason: "project",
      },
    ]);
  });

  it("skips unmapped add-ons (no provides/scope), keeping mapped ones", () => {
    const overlay = computeAddOnOverlay(
      { "agents-md": {}, bullmq: {} },
      lookup,
      [ctx("a", { messagingAdapter: "BullMQ" })],
    );
    assert.deepEqual(overlay, [
      {
        kind: "context-adapter",
        addOnId: "bullmq",
        capability: "messaging.out-adapter",
        contextId: "a",
        field: "messagingAdapter",
      },
    ]);
  });

  it("returns empty for no selection", () => {
    assert.deepEqual(
      computeAddOnOverlay({}, lookup, [
        ctx("a", { messagingAdapter: "BullMQ" }),
      ]),
      [],
    );
  });
});
