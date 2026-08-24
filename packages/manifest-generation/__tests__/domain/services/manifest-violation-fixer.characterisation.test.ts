import { describe, it } from "vitest";
import assert from "node:assert";
import yaml from "js-yaml";
import {
  canAutoFix,
  applyDeterministicFix,
} from "../../../src/domain/services/manifest-violation-fixer";
import { parseYamlToViewData } from "../../../src/domain/services/manifest-view-data-parser";
import type { ValidationItem } from "../../../src/domain/model/manifest-view-data";

/**
 * Characterisation of the CURRENT canAutoFix / applyDeterministicFix matrix
 * (repair-telemetry plan P0, stated risk mitigation: "Characterisation tests
 * over the current canAutoFix matrix before the refactor, not after").
 *
 * Items are produced by the REAL parser, not hand-built literals, so the
 * suite is signature-stable across the title→code refactor: whatever shape
 * the parser emits is what the fixer receives, exactly as in production
 * (deterministic-auto-fix.ts drives the same pair).
 */

function itemsFor(y: string): ValidationItem[] {
  return parseYamlToViewData(y).validationItems;
}

function only(
  items: ValidationItem[],
  pred: (v: ValidationItem) => boolean,
): ValidationItem {
  const hits = items.filter(pred);
  assert.strictEqual(
    hits.length,
    1,
    `expected exactly one matching item, got ${hits.length}: ${JSON.stringify(items, null, 2)}`,
  );
  return hits[0];
}

const BASE = `system: shop
scope: internal
architecture: modular-monolith
bounded_contexts:
  - name: orders
    type: core
    description: Orders.
    layers:
      application:
        ports:
          in: [OrdersCommandPort]
          out: [OrdersRepositoryPort]
      infrastructure:
        adapters: [OrdersRepositoryAdapter]
`;

describe("characterisation: canAutoFix / applyDeterministicFix per emitted class", () => {
  it("invalid-yaml: not fixable; fix returns null", () => {
    const items = itemsFor("foo: [unclosed");
    const v = only(items, (i) => i.status === "fail");
    assert.strictEqual(canAutoFix(v), false);
    assert.strictEqual(applyDeterministicFix("foo: [unclosed", v), null);
  });

  it("scope-missing: fixable; fix inserts scope: internal", () => {
    const y = BASE.replace("scope: internal\n", "");
    const v = only(
      itemsFor(y),
      (i) => i.status === "fail" && /scope/i.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), true);
    const out = applyDeterministicFix(y, v);
    assert.ok(out);
    assert.strictEqual(
      (yaml.load(out!) as { scope?: string }).scope,
      "internal",
    );
  });

  it("scope-defined (pass): not fixable", () => {
    const v = only(
      itemsFor(BASE),
      (i) => i.status === "pass" && /scope/i.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), false);
  });

  it("architecture-missing: fixable; fix inserts modular-monolith", () => {
    const y = BASE.replace("architecture: modular-monolith\n", "");
    const v = only(
      itemsFor(y),
      (i) => i.status === "fail" && /architecture/i.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), true);
    const out = applyDeterministicFix(y, v);
    assert.ok(out);
    assert.strictEqual(
      (yaml.load(out!) as { architecture?: string }).architecture,
      "modular-monolith",
    );
  });

  it("architecture-declared (pass): not fixable", () => {
    const v = only(
      itemsFor(BASE),
      (i) => i.status === "pass" && /architecture/i.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), false);
  });

  it("interface-contract warn (missing ports): fixable; synthesizes ports for non-shared-kernel", () => {
    const y = `scope: internal
architecture: modular-monolith
bounded_contexts:
  - name: orders
    type: core
    description: Orders.
`;
    const v = only(
      itemsFor(y),
      (i) => i.status === "warn" && i.title === "Minimum Interface Contract",
    );
    assert.strictEqual(canAutoFix(v), true);
    const out = applyDeterministicFix(y, v);
    assert.ok(out);
    const ctx = (
      yaml.load(out!) as {
        bounded_contexts: Array<{
          layers?: {
            application?: { ports?: { in?: string[]; out?: string[] } };
          };
        }>;
      }
    ).bounded_contexts[0];
    assert.ok((ctx.layers?.application?.ports?.in ?? []).length > 0);
    assert.ok((ctx.layers?.application?.ports?.out ?? []).length > 0);
  });

  it("interface-contract pass: not fixable", () => {
    const v = only(
      itemsFor(BASE),
      (i) => i.status === "pass" && i.title === "Minimum Interface Contract",
    );
    assert.strictEqual(canAutoFix(v), false);
  });

  it("context-name-hyphen: fixable; fix strips the leading hyphen", () => {
    const y = BASE.replace("name: orders", "name: -orders");
    const v = only(
      itemsFor(y),
      (i) => i.status === "fail" && /Context Name/.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), true);
    const out = applyDeterministicFix(y, v);
    assert.ok(out);
    const names = (
      yaml.load(out!) as { bounded_contexts: Array<{ name: string }> }
    ).bounded_contexts.map((c) => c.name);
    assert.deepStrictEqual(names, ["orders"]);
  });

  it("yaml-tag-indicator (port name with '!'): fixable; fix strips the bang everywhere in the context", () => {
    const y = BASE.replace(
      "out: [OrdersRepositoryPort]",
      "out: ['OrdersRepository!Port']",
    ).replace(
      "adapters: [OrdersRepositoryAdapter]",
      "adapters: ['OrdersRepository!Adapter']",
    );
    const items = itemsFor(y);
    const v = items.find(
      (i) => i.status === "warn" && /YAML Tag Indicator/.test(i.title),
    );
    assert.ok(v, `expected a tag-indicator item in ${JSON.stringify(items)}`);
    assert.strictEqual(canAutoFix(v!), true);
    const out = applyDeterministicFix(y, v!);
    assert.ok(out);
    assert.ok(!out!.includes("!Port") && !out!.includes("!Adapter"));
  });

  it("zero-adapters: fixable; fix synthesizes the missing adapter", () => {
    const y = BASE.replace(
      "adapters: [OrdersRepositoryAdapter]",
      "adapters: []",
    );
    const v = only(
      itemsFor(y),
      (i) => i.status === "fail" && /Zero Adapters/.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), true);
    const out = applyDeterministicFix(y, v);
    assert.ok(out);
    const adapters = (
      yaml.load(out!) as {
        bounded_contexts: Array<{
          layers?: { infrastructure?: { adapters?: string[] } };
        }>;
      }
    ).bounded_contexts[0].layers?.infrastructure?.adapters;
    assert.deepStrictEqual(adapters, ["OrdersRepositoryAdapter"]);
  });

  it("unconnected-ports: fixable; fix appends adapters for the unmatched ports", () => {
    const y = BASE.replace(
      "out: [OrdersRepositoryPort]",
      "out: [OrdersRepositoryPort, PaymentsGatewayPort]",
    );
    const v = only(
      itemsFor(y),
      (i) => i.status === "fail" && /Unconnected/.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), true);
    const out = applyDeterministicFix(y, v);
    assert.ok(out);
    const adapters = (
      yaml.load(out!) as {
        bounded_contexts: Array<{
          layers?: { infrastructure?: { adapters?: string[] } };
        }>;
      }
    ).bounded_contexts[0].layers?.infrastructure?.adapters;
    assert.ok(
      adapters?.includes("PaymentsGatewayAdapter"),
      JSON.stringify(adapters),
    );
  });

  it("ports-connected (pass): not fixable", () => {
    const v = only(
      itemsFor(BASE),
      (i) => i.status === "pass" && /Connected/.test(i.title),
    );
    assert.strictEqual(canAutoFix(v), false);
  });

  it("substring wart removed: a context NAMED to contain 'Unconnected' no longer makes its PASS item fixable", () => {
    // Pre-P0 behaviour (pinned before the refactor, 2026-08-23): canAutoFix
    // dispatched on title substrings of strings interpolating USER content, so
    // the PASS item `Unconnected-relay: Connected` returned TRUE. The plan
    // names this "a correctness wart worth removing while here" — this is the
    // one deliberate behaviour change in P0, asserted rather than silent.
    const y = BASE.replace("name: orders", "name: Unconnected-relay").replace(
      "OrdersCommandPort",
      "RelayCommandPort",
    );
    const items = itemsFor(y);
    const passItem = items.find(
      (i) => i.status === "pass" && i.title.includes("Connected"),
    );
    assert.ok(passItem);
    assert.strictEqual(canAutoFix(passItem!), false);
  });

  it("fix on an already-clean document returns null (no phantom change)", () => {
    const v = only(
      itemsFor(BASE),
      (i) => i.status === "pass" && /scope/i.test(i.title),
    );
    assert.strictEqual(applyDeterministicFix(BASE, v), null);
  });

  it("canAutoFix is false-by-default for codes outside the union at runtime (missing / unknown / prototype key)", () => {
    // TypeScript guarantees `code: ViolationCode` for in-repo callers, but the
    // function is an exported package boundary: loosely-typed or deserialized
    // data (persisted telemetry, JS consumers) can supply anything. The
    // boolean contract must hold there too — including for object-literal
    // prototype keys ("toString" et al.), where a plain lookup would return a
    // truthy inherited FUNCTION.
    const asItem = (code: unknown): ValidationItem =>
      ({
        status: "fail",
        code,
        title: "t",
        description: "d",
      }) as unknown as ValidationItem;
    assert.strictEqual(canAutoFix(asItem(undefined)), false);
    assert.strictEqual(canAutoFix(asItem("from-the-future")), false);
    assert.strictEqual(canAutoFix(asItem("toString")), false);
    assert.strictEqual(canAutoFix(asItem("__proto__")), false);
    assert.strictEqual(canAutoFix(asItem("constructor")), false);
  });

  it("applyDeterministicFix no-ops (returns null) on a code outside the union", () => {
    const future = {
      status: "fail",
      code: "from-the-future",
      title: "t",
      description: "d",
    } as unknown as ValidationItem;
    assert.strictEqual(applyDeterministicFix(BASE, future), null);
  });
});
