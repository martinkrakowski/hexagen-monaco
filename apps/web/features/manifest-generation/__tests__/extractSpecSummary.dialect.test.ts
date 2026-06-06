import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
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

  it("does not double-count a context carrying both use_cases and primary_use_cases", () => {
    const parsed = yaml.load(
      [
        "bounded_contexts:",
        "  - name: Orders",
        "    primary_use_cases:",
        "      - name: PlaceOrder",
        "      - name: CancelOrder",
        "use_cases:",
        "  Orders:",
        "    - name: PlaceOrder",
        "",
      ].join("\n"),
    ) as Record<string, unknown>;
    const s = extractSpecSummary(parsed);
    assert.equal(
      s.useCaseCount,
      1,
      "canonical use_cases[Orders] wins over dialect (matches normalizeDialect), not summed",
    );
  });
});
