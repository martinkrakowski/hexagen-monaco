import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseStructuredConfig,
  buildDomainAnalysisFromConfig,
  buildContextMappingsFromConfig,
  buildNormalizedPromptFromConfig,
  buildClassificationFromConfig,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

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
      (analysis.useCases ?? []).map((u) => u.name),
      ["GenerateCampaignUseCase"],
      "primary_use_cases must map to the canonical use_cases map",
    );

    // domain_models.value_objects → value objects (5).
    const voNames = (analysis.valueObjects ?? []).map((v) => v.name).sort();
    assert.deepEqual(voNames, [
      "AspectRatio",
      "ComplianceResult",
      "LogEntry",
      "PipelineExecutionLog",
      "PipelineResult",
    ]);
    // The enum VO carries its values as a derived rule.
    const ratio = (analysis.valueObjects ?? []).find(
      (v) => v.name === "AspectRatio",
    );
    assert.match(ratio?.rules ?? "", /1:1/);

    // domain_models.entities → aggregate roots (3), identity from the `id` attr.
    const aggNames = (analysis.aggregateRoots ?? []).map((a) => a.name).sort();
    assert.deepEqual(aggNames, ["CampaignBrief", "GeneratedAsset", "Product"]);
    assert.deepEqual(
      (analysis.aggregateRoots ?? []).find((a) => a.name === "CampaignBrief")
        ?.identityFields,
      ["id"],
    );

    // domain_events (objects) → domain events (3).
    const eventNames = (analysis.domainEvents ?? []).map((e) => e.name).sort();
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
      (analysis.aggregateRoots ?? []).map((a) => a.name),
      ["Order"],
      "empty aggregates:[] did not block dialect entities; nameless entry dropped",
    );
    assert.deepEqual(
      (analysis.valueObjects ?? []).map((v) => v.name),
      ["Money"],
    );
    assert.deepEqual(
      (analysis.domainEvents ?? []).map((e) => e.name),
      ["OrderPlaced"],
    );
    assert.deepEqual(
      (analysis.useCases ?? []).map((u) => u.name),
      ["PlaceOrder"],
      "nameless use case dropped",
    );
    assert.ok(
      (analysis.aggregateRoots ?? []).every((a) => typeof a.name === "string"),
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
      (analysis.useCases ?? []).map((u) => u.name),
      ["CanonicalPlaceOrder"],
      "canonical (alias-keyed) wins; the dialect entry must not also survive",
    );
  });

  it("treats an empty canonical use_cases array as absent (placeholder must not drop dialect use cases)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "use_cases:",
        "  Orders: []", // empty canonical placeholder — must not block the dialect
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepEqual(
      (analysis.useCases ?? []).map((u) => u.name),
      ["PlaceOrder"],
      "empty canonical placeholder is absent; the dialect primary_use_cases survive",
    );
  });

  it("preserves an object-form canonical use_cases entry over the dialect", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    primary_use_cases:",
        "      - name: DialectPlaceOrder",
        "use_cases:",
        "  Orders:", // object-form (a single use case, not a list) — still canonical
        "    name: CanonicalCharge",
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepEqual(
      (analysis.useCases ?? []).map((u) => u.name),
      ["CanonicalCharge"],
      "object-form canonical entry wins; the dialect entry must not overwrite it",
    );
  });

  it("maps domain_models.aggregates as roots and entities as child entities", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Campaigns",
        "    domain_models:",
        "      aggregates:",
        "        - name: CampaignBrief",
        "          attributes:", // array-form attributes
        "            - name: id",
        "              type: string",
        "            - name: products",
        '              type: "Product[]"',
        "        - name: GeneratedAsset",
        "      entities:",
        "        - name: Product",
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepEqual(
      (analysis.aggregateRoots ?? []).map((a) => a.name),
      ["CampaignBrief", "GeneratedAsset"],
      "declared aggregates are the roots",
    );
    assert.deepEqual(
      (analysis.entities ?? []).map((e) => e.name),
      ["Product"],
      "entities are child entities, not roots, when an aggregates list exists",
    );
    // Array-form attributes mapped, with `id` flagged as the identity key.
    const cb = config.bounded_contexts[0].aggregates?.find(
      (a) => a.name === "CampaignBrief",
    );
    assert.deepEqual(
      cb?.fields?.map((f) => `${f.name}:${f.type}${f.key ? "*" : ""}`),
      ["id:string*", "products:Product[]"],
    );
  });

  it("treats entities as roots when no explicit aggregates list is present (legacy)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Campaigns",
        "    domain_models:",
        "      entities:",
        "        - name: CampaignBrief",
        "        - name: Product",
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepEqual(
      (analysis.aggregateRoots ?? []).map((a) => a.name),
      ["CampaignBrief", "Product"],
    );
  });

  it("coerces an object-form `project` to its name (avoids [object Object])", () => {
    const config = parseStructuredConfig(
      [
        "project:",
        "  name: CampaignForge",
        "  description: An orchestrator",
        '  version: "0.1.0"',
        "bounded_contexts:",
        "  - name: Orders",
        "",
      ].join("\n"),
    );
    assert.equal(config.project, "CampaignForge");
    assert.equal(
      buildNormalizedPromptFromConfig(config).projectName,
      "CampaignForge",
      "projectName must be the name string, not the stringified object",
    );
  });

  it("maps context-mapping dialect aliases (relationship→pattern, via→mechanism) so same-pair entries stay distinct", () => {
    const config = parseStructuredConfig(
      [
        "context_mappings:",
        "  - upstream: CampaignOrchestration",
        "    downstream: CreativeGeneration",
        "    relationship: conformist",
        "    via: ImageGeneratorPort",
        "  - upstream: CampaignOrchestration",
        "    downstream: CreativeGeneration",
        "    relationship: conformist",
        "    via: CompositorPort",
        "bounded_contexts:",
        "  - name: CampaignOrchestration",
        "  - name: CreativeGeneration",
        "",
      ].join("\n"),
    );
    const mappings = buildContextMappingsFromConfig(config);
    assert.deepEqual(
      mappings.map(
        (m) => `${m.upstream}->${m.downstream}:${m.pattern}/${m.mechanism}`,
      ),
      [
        "CampaignOrchestration->CreativeGeneration:conformist/ImageGeneratorPort",
        "CampaignOrchestration->CreativeGeneration:conformist/CompositorPort",
      ],
      "the two same-pair mappings are distinct (different mechanism), not duplicates",
    );
  });

  it("dedupes out-ports when a name is in both driven and secondary_references", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    ports:",
        "      driven:",
        "        - name: PaymentPort",
        "      secondary_references:",
        "        - PaymentPort",
        "",
      ].join("\n"),
    );
    const orders = config.bounded_contexts.find((c) => c.name === "Orders");
    assert.deepEqual(
      orders?.layers?.application?.ports?.out,
      ["PaymentPort"],
      "duplicate out-port name collapsed to one entry",
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
      (analysis.valueObjects ?? []).map((v) => v.name),
      ["Money"],
    );
    assert.deepEqual(
      (analysis.useCases ?? []).map((u) => u.name),
      ["Charge"],
    );
  });
});

/**
 * Regression: a spec that expresses the shared kernel as an architectural
 * `plane` (per-context `plane: shared-kernel` and/or a top-level `planes:`
 * block) with the contexts left at `type: generic` used to lose the shared-
 * kernel exemption entirely — `inferContextType` reads `type`, not `plane`, so
 * those contexts were port-mapped and flagged R02/R17. normalizeDialect now maps
 * a shared-kernel plane onto the canonical `type`.
 */
describe("structured-config import — shared-kernel plane mapping", () => {
  it("maps a per-context `plane: shared-kernel` onto type (over a declared type:generic)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: scene-types",
        "    type: generic",
        "    plane: shared-kernel",
        "  - name: scene-orchestration",
        "    type: core",
        "    plane: core",
        "",
      ].join("\n"),
    );
    const typeByName = Object.fromEntries(
      config.bounded_contexts.map((c) => [c.name, c.type]),
    );
    assert.equal(
      typeByName["scene-types"],
      "shared-kernel",
      "shared-kernel plane wins over a declared type:generic",
    );
    assert.equal(
      typeByName["scene-orchestration"],
      "core",
      "a non-shared-kernel plane leaves the declared type untouched",
    );
  });

  it("honors a top-level `planes: { shared-kernel: [...] }` block", () => {
    const config = parseStructuredConfig(
      [
        "planes:",
        "  shared-kernel:",
        "    - scene-types",
        "    - correction-delta",
        "  core:",
        "    - scene-orchestration",
        "bounded_contexts:",
        "  - name: scene-types",
        "    type: generic",
        "  - name: correction-delta",
        "    type: generic",
        "  - name: scene-orchestration",
        "    type: core",
        "",
      ].join("\n"),
    );
    const typeByName = Object.fromEntries(
      config.bounded_contexts.map((c) => [c.name, c.type]),
    );
    assert.equal(typeByName["scene-types"], "shared-kernel");
    assert.equal(typeByName["correction-delta"], "shared-kernel");
    assert.equal(typeByName["scene-orchestration"], "core");
  });

  it("propagates the mapped type into the deterministic classification (what Stage 3 reads)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: scene-types",
        "    type: generic",
        "    plane: shared-kernel",
        "",
      ].join("\n"),
    );
    const analysis = buildDomainAnalysisFromConfig(config);
    const classification = buildClassificationFromConfig(config, analysis);
    const sceneTypes = classification.accepted.find(
      (c) => c.name === "scene-types",
    );
    assert.equal(
      sceneTypes?.type,
      "shared-kernel",
      "classification.accepted carries shared-kernel so Stage 3 skips it",
    );
  });

  it("leaves a context with no plane/planes untouched (idempotent)", () => {
    const config = parseStructuredConfig(
      ["bounded_contexts:", "  - name: Billing", "    type: core", ""].join(
        "\n",
      ),
    );
    assert.equal(config.bounded_contexts[0].type, "core");
  });
});
