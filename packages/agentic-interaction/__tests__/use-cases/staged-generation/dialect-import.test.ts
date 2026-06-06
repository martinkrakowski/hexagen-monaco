import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseStructuredConfig,
  buildDomainAnalysisFromConfig,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";

/**
 * Regression: a spec authored in the rich "hexagonal" dialect — domain content
 * under `domain_models`, per-context `primary_use_cases`, object-form
 * `domain_events`, and driving/driven `ports` — used to import as 0 use cases
 * (and dropped entities/value-objects/events) because buildDomainAnalysisFromConfig
 * reads only the canonical fields. normalizeDialect (in parseStructuredConfig)
 * now maps the dialect onto those fields. Fixture is the exact CampaignForge spec
 * that surfaced the miscount.
 */
const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const campaignForge = fs.readFileSync(
  path.join(fixturesDir, "campaignforge-dialect.yaml"),
  "utf8",
);

describe("structured-config import — rich hexagonal dialect (CampaignForge)", () => {
  it("captures domain content authored under the dialect (no silent drop)", () => {
    const config = parseStructuredConfig(campaignForge);
    const analysis = buildDomainAnalysisFromConfig(config);

    // The use case — the visible "0 use cases" symptom — must be captured.
    assert.deepEqual(
      analysis.useCases.map((u) => u.name),
      ["GenerateCampaignUseCase"],
      "primary_use_cases must map to the canonical use_cases map",
    );

    // domain_models.value_objects → value objects (5).
    const voNames = analysis.valueObjects.map((v) => v.name).sort();
    assert.deepEqual(voNames, [
      "AspectRatio",
      "ComplianceResult",
      "LogEntry",
      "PipelineExecutionLog",
      "PipelineResult",
    ]);
    // The enum VO carries its values as a derived rule.
    const ratio = analysis.valueObjects.find((v) => v.name === "AspectRatio");
    assert.match(ratio?.rules ?? "", /1:1/);

    // domain_models.entities → aggregate roots (3), identity from the `id` attr.
    const aggNames = analysis.aggregateRoots.map((a) => a.name).sort();
    assert.deepEqual(aggNames, ["CampaignBrief", "GeneratedAsset", "Product"]);
    assert.deepEqual(
      analysis.aggregateRoots.find((a) => a.name === "CampaignBrief")
        ?.identityFields,
      ["id"],
    );

    // domain_events (objects) → domain events (3).
    const eventNames = analysis.domainEvents.map((e) => e.name).sort();
    assert.deepEqual(eventNames, [
      "AssetComposited",
      "CampaignBriefIngested",
      "PipelineHalted",
    ]);

    // ports.{primary → in; driven/secondary_references → out} → layers ports,
    // so the pre-defined-port path honours the author's declared contracts.
    const orch = config.bounded_contexts.find(
      (c) => c.name === "CampaignOrchestration",
    );
    assert.deepEqual(orch?.layers?.application?.ports?.in, [
      "CampaignPipelinePort",
    ]);
    for (const p of [
      "ImageGeneratorPort",
      "CompositorPort",
      "CompliancePort",
      "ExportPort",
    ]) {
      assert.ok(
        orch?.layers?.application?.ports?.out?.includes(p),
        `expected ${p} among out-ports`,
      );
    }
    const creative = config.bounded_contexts.find(
      (c) => c.name === "CreativeGeneration",
    );
    assert.deepEqual(
      creative?.layers?.application?.ports?.out?.sort(),
      ["CompositorPort", "ImageGeneratorPort"],
      "driven ports map to out-ports",
    );
  });

  it("treats empty canonical arrays as absent and drops nameless dialect entries", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    aggregates: []", // empty canonical placeholder must not block dialect
        "    value_objects: []",
        "    events_published: []",
        "    domain_models:",
        "      entities:",
        "        - name: Order",
        "        - notname: bad", // nameless → dropped (no undefined-named aggregate)
        "      value_objects:",
        "        - name: Money",
        "    domain_events:",
        "      - name: OrderPlaced",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "      - foo: bar", // nameless → dropped
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);

    assert.deepEqual(
      analysis.aggregateRoots.map((a) => a.name),
      ["Order"],
      "empty aggregates:[] did not block dialect entities; nameless entry dropped",
    );
    assert.deepEqual(
      analysis.valueObjects.map((v) => v.name),
      ["Money"],
    );
    assert.deepEqual(
      analysis.domainEvents.map((e) => e.name),
      ["OrderPlaced"],
    );
    assert.deepEqual(
      analysis.useCases.map((u) => u.name),
      ["PlaceOrder"],
      "nameless use case dropped",
    );
    assert.ok(
      analysis.aggregateRoots.every((a) => typeof a.name === "string"),
      "no undefined-named aggregates propagate",
    );
  });

  it("canonical use_cases win over the dialect even when keyed by a context alias (short)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: OrderManagement",
        "    short: orders",
        "    primary_use_cases:",
        "      - name: DialectPlaceOrder",
        "use_cases:",
        "  orders:", // canonical keyed by the alias `short`, not `name`
        "    - name: CanonicalPlaceOrder",
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepEqual(
      analysis.useCases.map((u) => u.name),
      ["CanonicalPlaceOrder"],
      "canonical (alias-keyed) wins; the dialect entry must not also survive",
    );
  });

  it("leaves a canonical-shape config untouched (idempotent)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Billing",
        "    value_objects:",
        "      - name: Money",
        "use_cases:",
        "  Billing:",
        "    - name: Charge",
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepEqual(
      analysis.valueObjects.map((v) => v.name),
      ["Money"],
    );
    assert.deepEqual(
      analysis.useCases.map((u) => u.name),
      ["Charge"],
    );
  });
});
