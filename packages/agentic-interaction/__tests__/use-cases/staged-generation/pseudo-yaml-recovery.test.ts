import { describe, it } from "vitest";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  parseStructuredConfig,
  buildDomainAnalysisFromConfig,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";
import { sanitizePseudoYaml } from "../../../src/domain/utils/sanitize-pseudo-yaml.ts";

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

  it("quotes a SINGLE-quoted union mapping value (#260 CodeRabbit)", () => {
    const out = sanitizePseudoYaml("status: 'open' | 'closed'");
    // Wrapped in YAML single quotes (inner `'` doubled) so the union survives.
    assert.equal(out, `status: '''open'' | ''closed'''`);
    // Round-trips to the literal string instead of throwing on the bare pipe.
    assert.deepEqual(yaml.load(out), { status: "'open' | 'closed'" });
  });

  it("does not collapse a valid mapping item whose key ends in () (#260)", () => {
    // `- validate(input): true` is a legitimate mapping item (key
    // "validate(input)" → true): the colon is OUTSIDE the parens, so it isn't the
    // method-signature breaker. It must survive untouched even when another line
    // triggers whole-document recovery.
    const input = "  - validate(input): true";
    assert.equal(sanitizePseudoYaml(input), input);
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

  it("quotes a TypeScript-signature MAPPING value (import-hardening G5)", () => {
    // The mapping-value twin of the sequence-item case: the colon inside the
    // parenthesised args breaks js-yaml. Previously unhandled, so a spec
    // declaring port methods this way fell to the lossy LLM conversion.
    const out = sanitizePseudoYaml(
      [
        "ports:",
        "  driven:",
        "    - name: OrderRepositoryPort",
        "      signature: (order: Order) => Promise<void>",
      ].join("\n"),
    );
    assert.match(out, /signature: "\(order: Order\) => Promise<void>"/);
    assert.deepEqual(
      (yaml.load(out) as { ports: { driven: unknown[] } }).ports.driven,
      [
        {
          name: "OrderRepositoryPort",
          signature: "(order: Order) => Promise<void>",
        },
      ],
    );
  });

  it("quotes a bare arrow-function mapping value", () => {
    const out = sanitizePseudoYaml("derived: () => Date.now()");
    assert.equal(out, `derived: "() => Date.now()"`);
  });

  it("skips mapping values carrying an inline comment", () => {
    // Quoting would swallow the comment into the value — leave the line alone.
    const input = "signature: (a: B) => C # explained here";
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
