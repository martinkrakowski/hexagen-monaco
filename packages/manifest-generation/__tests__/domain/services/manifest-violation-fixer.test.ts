import { describe, it } from "vitest";
import assert from "node:assert";
import yaml from "js-yaml";
import {
  canAutoFix,
  applyDeterministicFix,
} from "../../../src/domain/services/manifest-violation-fixer";
import type { ValidationItem } from "../../../src/domain/model/manifest-view-data";

const MISSING_PORTS: ValidationItem = {
  status: "warn",
  // Mechanical edit forced by the P0 signature change (code is required);
  // the assertions below are untouched.
  code: "interface-contract-missing-ports",
  title: "Minimum Interface Contract",
  description: "Some bounded contexts are missing ports in/out.",
};

const YAML = `bounded_contexts:
  - name: scene-types
    type: shared-kernel
    description: Type-only contracts.
  - name: orders
    type: core
    description: Orders.
`;

interface Ctx {
  name?: string;
  layers?: { application?: { ports?: { in?: string[]; out?: string[] } } };
}
const ctxOf = (y: string, name: string): Ctx =>
  ((yaml.load(y) as { bounded_contexts?: Ctx[] }).bounded_contexts || []).find(
    (c) => c.name === name,
  )!;

describe("applyDeterministicFix — Minimum Interface Contract", () => {
  it("never synthesizes ports for a shared-kernel (regression: re-add loop)", () => {
    assert.ok(canAutoFix(MISSING_PORTS));
    const out = applyDeterministicFix(YAML, MISSING_PORTS);
    assert.ok(
      out,
      "the fix produced output (the core context still needs ports)",
    );
    const sk = ctxOf(out!, "scene-types");
    // The shared-kernel stays type-only: no ports synthesized.
    assert.deepStrictEqual(sk.layers?.application?.ports?.in ?? [], []);
    assert.deepStrictEqual(sk.layers?.application?.ports?.out ?? [], []);
  });

  it("still synthesizes default ports for a non-shared-kernel context", () => {
    const out = applyDeterministicFix(YAML, MISSING_PORTS)!;
    const core = ctxOf(out, "orders");
    assert.ok(
      (core.layers?.application?.ports?.in ?? []).length > 0,
      "the core context gets a synthesized inbound port",
    );
    assert.ok(
      (core.layers?.application?.ports?.out ?? []).length > 0,
      "the core context gets a synthesized outbound port",
    );
  });
});
