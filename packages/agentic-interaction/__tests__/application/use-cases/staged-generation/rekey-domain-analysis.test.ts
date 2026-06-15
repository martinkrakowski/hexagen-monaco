import { test, describe } from "node:test";
import assert from "node:assert";
import { rekeyDomainAnalysisToManifest } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

// rekeyDomainAnalysisToManifest re-keys a reused stage-1 domain analysis to the
// REPAIRED context names so Stage-5 re-attaches each context's domain model. It
// MUST key on each member's OLD SUBDOMAIN, never on its NAME: a flat
// name→context map collapses value-object names shared by two contexts
// (Address, Money, Email …) onto one — last-write-wins — silently dropping the
// other context's domain on ANY applied repair, not just renames. (PR #344
// collision blocker — empirically reproduced before this fix.)

const da = (
  valueObjects: Array<{ name: string; subdomain: string }>,
  aggregateRoots: Array<{ name: string; subdomain: string }> = [],
) =>
  ({
    verbs: [],
    nouns: [],
    subdomains: [],
    aggregateRoots,
    entities: [],
    valueObjects,
    domainEvents: [],
    useCases: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const mf = (
  contexts: Array<{
    name: string;
    entities?: string[];
    value_objects?: string[];
  }>,
) =>
  ({
    bounded_contexts: contexts.map((c) => ({
      name: c.name,
      layers: {
        domain: {
          entities: c.entities ?? [],
          value_objects: c.value_objects ?? [],
        },
      },
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("rekeyDomainAnalysisToManifest — collision safety (PR #344)", () => {
  test("NO rename + a value object shared by two contexts → both keep it (no last-write-wins collapse)", () => {
    const stage1 = da([
      { name: "Address", subdomain: "orders" },
      { name: "Address", subdomain: "shipping" },
    ]);
    const manifest = mf([
      { name: "orders", value_objects: ["Address"] },
      { name: "shipping", value_objects: ["Address"] },
    ]);
    const out = rekeyDomainAnalysisToManifest(stage1, manifest);
    // Pre-fix this collapsed to ["shipping","shipping"] (orders lost its Address).
    const subdomains = out.valueObjects
      .map((v: { subdomain?: string }) => v.subdomain)
      .sort();
    assert.deepStrictEqual(subdomains, ["orders", "shipping"]);
  });

  test("a rename moves only the renamed context's members; a sibling's same-named VO is untouched", () => {
    const stage1 = da(
      [
        { name: "Address", subdomain: "payment-gateway" },
        { name: "Address", subdomain: "shipping" },
      ],
      [{ name: "Payment", subdomain: "payment-gateway" }],
    );
    // payment-gateway → billing (R01 rename); shipping unchanged.
    const manifest = mf([
      { name: "billing", entities: ["Payment"], value_objects: ["Address"] },
      { name: "shipping", value_objects: ["Address"] },
    ]);
    const out = rekeyDomainAnalysisToManifest(stage1, manifest);

    const payment = out.aggregateRoots.find(
      (a: { name: string }) => a.name === "Payment",
    );
    assert.strictEqual(payment?.subdomain, "billing");

    const billingAddr = out.valueObjects.filter(
      (v: { name: string; subdomain?: string }) =>
        v.name === "Address" && v.subdomain === "billing",
    );
    const shippingAddr = out.valueObjects.filter(
      (v: { name: string; subdomain?: string }) =>
        v.name === "Address" && v.subdomain === "shipping",
    );
    assert.strictEqual(
      billingAddr.length,
      1,
      "renamed context keeps its Address",
    );
    assert.strictEqual(
      shippingAddr.length,
      1,
      "sibling's Address is not stolen or duplicated",
    );
  });

  test("an additive (no-rename) repair is a strict no-op — returns the input unchanged", () => {
    const stage1 = da([{ name: "Money", subdomain: "billing" }]);
    const manifest = mf([{ name: "billing", value_objects: ["Money"] }]);
    assert.strictEqual(rekeyDomainAnalysisToManifest(stage1, manifest), stage1);
  });
});
