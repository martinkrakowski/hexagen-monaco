import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  parseStructuredConfig,
  buildDomainAnalysisFromConfig,
} from "@hexagen/agentic-interaction";
import { extractSpecSummary } from "../import-project-spec/utils";

/**
 * Regression: the Spec Review counted 0 use cases (and 0 value objects /
 * aggregates) for specs authored in the rich "hexagonal" dialect — domain
 * content under `domain_models`, per-context `primary_use_cases` — because
 * extractSpecSummary read only the canonical fields. It now counts both, matching
 * normalizeDialect in the structured-config pipeline.
 */
const dialect = `
bounded_contexts:
  - name: Orders
    domain_models:
      entities:
        - name: Order
        - name: LineItem
      value_objects:
        - name: Money
        - name: Address
        - name: Sku
    primary_use_cases:
      - name: PlaceOrder
      - name: CancelOrder
  - name: Catalog
    domain_models:
      entities:
        - name: Product
`;

const canonical = `
bounded_contexts:
  - name: Billing
    aggregates:
      - name: Invoice
    value_objects:
      - name: Money
use_cases:
  Billing:
    - name: Charge
`;

describe("extractSpecSummary — rich hexagonal dialect", () => {
  it("counts domain_models.{entities,value_objects} and primary_use_cases", () => {
    const parsed = yaml.load(dialect) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(s.contextCount, 2, "two bounded contexts");
    assert.equal(s.aggregateCount, 3, "Order + LineItem + Product");
    assert.equal(s.valueObjectCount, 3, "Money + Address + Sku");
    assert.equal(s.useCaseCount, 2, "PlaceOrder + CancelOrder (was 0)");
  });

  it("still counts the canonical shape (no regression)", () => {
    const parsed = yaml.load(canonical) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(s.contextCount, 1);
    assert.equal(s.aggregateCount, 1);
    assert.equal(s.valueObjectCount, 1);
    assert.equal(s.useCaseCount, 1);
  });

  it("counts domain_models.aggregates as roots; entities are children (not roots)", () => {
    const split = `
bounded_contexts:
  - name: Campaigns
    domain_models:
      aggregates:
        - name: CampaignBrief
        - name: GeneratedAsset
      entities:
        - name: Product
      value_objects:
        - name: AspectRatio
`;
    const s = extractSpecSummary(yaml.load(split) as Record<string, unknown>);
    assert.equal(
      s.aggregateCount,
      2,
      "two declared aggregate roots; Product is a child entity, not a root",
    );
    assert.equal(s.valueObjectCount, 1);
  });

  it("treats empty canonical arrays as absent (counts the dialect)", () => {
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    aggregates: []",
        "    value_objects: []",
        "    domain_models:",
        "      entities:",
        "        - name: Order",
        "      value_objects:",
        "        - name: Money",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(
      s.aggregateCount,
      1,
      "empty aggregates:[] does not mask dialect",
    );
    assert.equal(s.valueObjectCount, 1);
    assert.equal(s.useCaseCount, 1);
  });

  it("prefers canonical use_cases over primary_use_cases for the same context (no double-count)", () => {
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "      - name: CancelOrder",
        "use_cases:",
        "  Orders:",
        "    - name: CanonicalOrderFlow",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(
      s.useCaseCount,
      1,
      "canonical Orders (1) wins over dialect (2) — matches normalizeDialect, not summed",
    );
  });

  it("canonical use_cases keyed by a context alias (short) still win in the count", () => {
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: OrderManagement",
        "    short: orders",
        "    primary_use_cases:",
        "      - name: DialectPlaceOrder",
        "use_cases:",
        "  orders:",
        "    - name: CanonicalPlaceOrder",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(
      s.useCaseCount,
      1,
      "alias-keyed canonical wins; dialect not added",
    );
  });

  it("matches the pipeline when the canonical key only NORMALIZES-equal to the context (not exact)", () => {
    // normalizeContextName("OrderManagement") === normalizeContextName("order-management")
    // → the pipeline treats this context as covered by canonical (imports 1). The
    // summary must agree (was an exact-key check → would have double-counted to 2).
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: OrderManagement",
        "    primary_use_cases:",
        "      - name: DialectPlaceOrder",
        "use_cases:",
        "  order-management:",
        "    - name: CanonicalPlaceOrder",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(
      s.useCaseCount,
      1,
      "normalized-equal canonical key wins; no double-count vs the pipeline",
    );
  });

  it("an EMPTY canonical use_cases placeholder does not block the dialect (#260)", () => {
    // `use_cases: { Orders: [] }` is an empty placeholder. The engine drops it
    // (hasUseCaseContent) and keeps the dialect's primary_use_cases — so the
    // review must count 2, not 0. Previously the web built canonicalKeys from
    // every key (incl. empty ones), suppressed the dialect, and showed 0.
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "      - name: CancelOrder",
        "use_cases:",
        "  Orders: []",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    assert.equal(extractSpecSummary(parsed).useCaseCount, 2);
  });

  it("counts an object-form canonical use_cases entry as one (#260)", () => {
    // `use_cases: { Orders: { name: Charge } }` — a single object, not an array.
    // The engine counts it via `Array.isArray(ucs) ? ucs : [ucs]` → 1. The web
    // previously coerced the object to `[]` → 0.
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "use_cases:",
        "  Orders:",
        "    name: Charge",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    assert.equal(extractSpecSummary(parsed).useCaseCount, 1);
  });

  it("treats an empty object canonical entry as content-bearing → 1 (#260)", () => {
    // `use_cases: { Orders: {} }` — a non-array object, even empty, is content per
    // the engine's `Array.isArray(ucs) ? ucs : [ucs]` (→ `[{}]`, one nameless use
    // case). The web must agree (counts 1), not coerce it to 0.
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "use_cases:",
        "  Orders: {}",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    assert.equal(extractSpecSummary(parsed).useCaseCount, 1);
  });

  it("does not count nameless dialect entries (mirrors the pipeline's withName)", () => {
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    domain_models:",
        "      entities:",
        "        - name: Order",
        "        - notname: bad",
        "      value_objects:",
        "        - name: Money",
        "        - {}",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "      - foo: bar",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(s.aggregateCount, 1, "nameless entity not counted");
    assert.equal(s.valueObjectCount, 1, "nameless value object not counted");
    assert.equal(s.useCaseCount, 1, "nameless use case not counted");
  });
});

/**
 * Drift firewall (#260): `extractSpecSummary` (web preview) and
 * `normalizeDialect` + `buildDomainAnalysisFromConfig` (engine import) encode the
 * same dialect-counting rules in two places — by necessity, since the engine
 * module can't be pulled into the client bundle. This feeds the SAME spec through
 * both and asserts the preview count equals what actually imports, so a future
 * edit to one side that diverges from the other fails here instead of silently
 * shipping a lying preview.
 */
describe("extractSpecSummary ⇄ pipeline count parity", () => {
  const specs: Record<string, string> = {
    "rich dialect (entities + primary_use_cases)": dialect,
    "canonical shape": canonical,
    "empty canonical placeholder keeps dialect": [
      "bounded_contexts:",
      "  - name: Orders",
      "    primary_use_cases:",
      "      - name: PlaceOrder",
      "      - name: CancelOrder",
      "use_cases:",
      "  Orders: []",
    ].join("\n"),
    "object-form canonical entry": [
      "bounded_contexts:",
      "  - name: Orders",
      "use_cases:",
      "  Orders:",
      "    name: Charge",
    ].join("\n"),
    "empty-object canonical entry": [
      "bounded_contexts:",
      "  - name: Orders",
      "use_cases:",
      "  Orders: {}",
    ].join("\n"),
    "canonical wins over dialect for same context": [
      "bounded_contexts:",
      "  - name: Orders",
      "    primary_use_cases:",
      "      - name: PlaceOrder",
      "      - name: CancelOrder",
      "use_cases:",
      "  Orders:",
      "    - name: CanonicalOrderFlow",
    ].join("\n"),
    "alias-keyed canonical (normalizes-equal) wins": [
      "bounded_contexts:",
      "  - name: OrderManagement",
      "    primary_use_cases:",
      "      - name: DialectPlaceOrder",
      "use_cases:",
      "  order-management:",
      "    - name: CanonicalPlaceOrder",
    ].join("\n"),
    "aggregates as roots, entities as children": [
      "bounded_contexts:",
      "  - name: Campaigns",
      "    domain_models:",
      "      aggregates:",
      "        - name: CampaignBrief",
      "        - name: GeneratedAsset",
      "      entities:",
      "        - name: Product",
    ].join("\n"),
  };

  for (const [label, raw] of Object.entries(specs)) {
    it(`agrees on use-case and aggregate-root counts: ${label}`, () => {
      const preview = extractSpecSummary(
        yaml.load(raw) as Record<string, unknown>,
      );
      const analysis = buildDomainAnalysisFromConfig(
        parseStructuredConfig(raw),
      );
      assert.equal(
        preview.useCaseCount,
        analysis.useCases.length,
        "use-case count must match the pipeline import",
      );
      assert.equal(
        preview.aggregateCount,
        (analysis.aggregateRoots ?? []).length,
        "aggregate-root count must match the pipeline import",
      );
    });
  }
});
