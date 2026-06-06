import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  parseStructuredConfig,
  sanitizePseudoYaml,
  buildDomainAnalysisFromConfig,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";

/**
 * Specs are frequently authored as "pseudo-YAML" that embeds TypeScript syntax
 * (method signatures under `methods:`, quoted union types). That is not valid
 * YAML, so a strict parse throws and the whole spec is shunted to the lossy LLM
 * conversion path — collapsing a rich multi-context spec into near-nothing.
 * `sanitizePseudoYaml` + the recovery pass in `parseStructuredConfig` quote those
 * scalars so the deterministic structured-config path (incl. normalizeDialect)
 * runs instead.
 */
describe("sanitizePseudoYaml", () => {
  it("quotes a method-signature sequence item", () => {
    const out = sanitizePseudoYaml(
      ["methods:", "  - execute(brief: Brief): Promise<Result>"].join("\n"),
    );
    assert.match(out, /- "execute\(brief: Brief\): Promise<Result>"/);
  });

  it("quotes a quoted-union mapping value", () => {
    assert.equal(
      sanitizePseudoYaml('level: "info" | "warn" | "error"'),
      `level: '"info" | "warn" | "error"'`,
    );
  });

  it("leaves ordinary YAML lines untouched", () => {
    const input = [
      "  - name: Orders", // mapping item, no parens
      "    nullable: string | null", // unquoted union — valid scalar
      'version: "0.1.0"', // plain quoted scalar, no pipe
      "  - PaymentPort", // bare scalar item
    ].join("\n");
    assert.equal(sanitizePseudoYaml(input), input);
  });
});

describe("parseStructuredConfig — pseudo-YAML recovery", () => {
  const pseudo = [
    "bounded_contexts:",
    "  - name: Orders",
    "    ports:",
    "      primary:",
    "        - name: OrderPort",
    "          methods:",
    "            - placeOrder(cmd: PlaceOrder): Promise<OrderId>",
    "    domain_models:",
    "      entities:",
    "        - name: Order",
    "          attributes:",
    "            id: string",
    '            status: "open" | "closed"',
    "    primary_use_cases:",
    "      - name: PlaceOrder",
    "",
  ].join("\n");

  it("recovers a TypeScript-in-YAML spec that strict parsing rejects", () => {
    // The raw spec genuinely is not valid YAML.
    assert.throws(() => yaml.load(pseudo));

    const cfg = parseStructuredConfig(pseudo);
    assert.equal(cfg.bounded_contexts.length, 1);
    assert.equal(cfg.bounded_contexts[0].name, "Orders");

    const analysis = buildDomainAnalysisFromConfig(cfg);
    assert.deepEqual(
      analysis.useCases.map((u) => u.name),
      ["PlaceOrder"],
    );
    assert.deepEqual(
      (analysis.aggregateRoots ?? []).map((a) => a.name),
      ["Order"],
    );
  });

  it("does not alter a spec that is already valid YAML", () => {
    const valid = [
      "bounded_contexts:",
      "  - name: Billing",
      "    value_objects:",
      "      - name: Money",
      "use_cases:",
      "  Billing:",
      "    - name: Charge",
      "",
    ].join("\n");
    const cfg = parseStructuredConfig(valid);
    const analysis = buildDomainAnalysisFromConfig(cfg);
    assert.deepEqual(
      analysis.useCases.map((u) => u.name),
      ["Charge"],
    );
  });
});
