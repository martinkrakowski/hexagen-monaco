import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  normalizeDialect,
  type StructuredConfig,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

/**
 * Ingestion sanitization: the loose-spec conversion output is only
 * shape-checked ("bounded_contexts non-empty"), so `apps`, `context_mappings`,
 * and the canonical per-context lists are untrusted LLM output. normalizeDialect
 * runs on EVERY parseStructuredConfig path and must filter/coerce them BEFORE
 * the user reviews the converted spec — otherwise a nameless app entry flows
 * verbatim into the assembled manifest and fails the accept screen's strict
 * ManifestSchema parse (the alvaro-ai import failure).
 */
describe("normalizeDialect — LLM-output sanitization", () => {
  const ctx = (name: string) => ({ name, responsibility: name });

  it("coerces bare-string apps and drops nameless app entries", () => {
    const config = {
      bounded_contexts: [ctx("orders")],
      apps: [
        "web",
        { framework: "next.js" },
        { name: "api", framework: "nitro" },
        null,
      ],
    } as unknown as StructuredConfig;

    const result = normalizeDialect(config);
    assert.deepEqual(result.apps, [
      { name: "web" },
      { name: "api", framework: "nitro" },
    ]);
  });

  it("drops context mappings missing either endpoint", () => {
    const config = {
      bounded_contexts: [ctx("orders"), ctx("billing")],
      context_mappings: [
        { upstream: "orders", downstream: "billing" },
        { upstream: "orders" },
        { downstream: "billing" },
        { upstream: "", downstream: "billing" },
        null,
      ],
    } as unknown as StructuredConfig;

    const result = normalizeDialect(config);
    assert.deepEqual(result.context_mappings, [
      { upstream: "orders", downstream: "billing" },
    ]);
  });

  it("filters nameless canonical aggregates/value objects and non-string events", () => {
    const config = {
      bounded_contexts: [
        {
          ...ctx("orders"),
          aggregates: [{ name: "Order" }, { root: true }],
          value_objects: [{ name: "Money" }, {}],
          events_published: ["OrderPlaced", null, 42],
        },
      ],
    } as unknown as StructuredConfig;

    const result = normalizeDialect(config);
    const orders = result.bounded_contexts[0];
    assert.deepEqual(
      orders.aggregates?.map((a) => a.name),
      ["Order"],
    );
    assert.deepEqual(
      orders.value_objects?.map((v) => v.name),
      ["Money"],
    );
    assert.deepEqual(orders.events_published, ["OrderPlaced"]);
  });

  it("falls back to domain_models when every canonical aggregate is nameless", () => {
    const config = {
      bounded_contexts: [
        {
          ...ctx("orders"),
          aggregates: [{ root: true }],
          domain_models: { aggregates: [{ name: "Order" }] },
        },
      ],
    } as unknown as StructuredConfig;

    const result = normalizeDialect(config);
    assert.deepEqual(
      result.bounded_contexts[0].aggregates?.map((a) => a.name),
      ["Order"],
    );
  });
});
