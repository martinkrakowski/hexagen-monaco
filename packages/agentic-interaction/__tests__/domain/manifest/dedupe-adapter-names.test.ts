import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dedupeAdapterNames } from "../../../src/domain/manifest/dedupe-adapter-names";
import type { AdapterBindings } from "../../../src/domain/value-objects/pipeline-state";

const adapter = (name: string, implementsPort: string) => ({
  name,
  type: "HttpClient",
  implements: implementsPort,
});

describe("dedupeAdapterNames", () => {
  it("returns the input unchanged when all adapter names are unique", () => {
    const input: AdapterBindings = {
      contexts: [
        {
          contextName: "customer-onboarding",
          adapters: [adapter("OnboardClientAdapter", "OnboardPort")],
        },
        {
          contextName: "invoicing-billing",
          adapters: [
            adapter("InvoiceRepositoryAdapter", "InvoiceRepositoryPort"),
          ],
        },
      ],
    };
    const result = dedupeAdapterNames(input);
    // Same reference back — the common case has no dupes, so no churn.
    assert.strictEqual(result.adapterBindings, input);
    assert.deepStrictEqual(result.renamed, []);
  });

  it("renames a cross-context duplicate (first kept, second context-prefixed)", () => {
    const input: AdapterBindings = {
      contexts: [
        {
          contextName: "customer-onboarding",
          adapters: [adapter("StripeClientAdapter", "StripePaymentPort")],
        },
        {
          contextName: "invoicing-billing",
          adapters: [adapter("StripeClientAdapter", "StripeInvoicePort")],
        },
      ],
    };
    const result = dedupeAdapterNames(input);
    assert.strictEqual(
      result.adapterBindings.contexts[0].adapters[0].name,
      "StripeClientAdapter",
    );
    assert.strictEqual(
      result.adapterBindings.contexts[1].adapters[0].name,
      "InvoicingBillingStripeClientAdapter",
    );
    assert.deepStrictEqual(result.renamed, [
      {
        contextName: "invoicing-billing",
        from: "StripeClientAdapter",
        to: "InvoicingBillingStripeClientAdapter",
      },
    ]);
  });

  it("falls back to an integer suffix when the prefixed name is also taken", () => {
    const input: AdapterBindings = {
      contexts: [
        {
          contextName: "billing",
          adapters: [adapter("StripeClientAdapter", "P1")],
        },
        // A real adapter already named exactly like the prefixed form.
        {
          contextName: "x",
          adapters: [adapter("BillingStripeClientAdapter", "P2")],
        },
        // Original "StripeClientAdapter" taken AND prefixed "BillingStripeClientAdapter"
        // taken → smallest free integer suffix.
        {
          contextName: "billing",
          adapters: [adapter("StripeClientAdapter", "P3")],
        },
      ],
    };
    const result = dedupeAdapterNames(input);
    assert.strictEqual(
      result.adapterBindings.contexts[2].adapters[0].name,
      "BillingStripeClientAdapter2",
    );
  });

  it("walks the integer suffix past further collisions (…2 taken → …3)", () => {
    const input: AdapterBindings = {
      contexts: [
        {
          contextName: "billing",
          adapters: [adapter("StripeClientAdapter", "P1")],
        },
        // The prefixed form AND its …2 are both already taken, so the loop body
        // (n += 1) must run to reach the next free suffix.
        {
          contextName: "x",
          adapters: [adapter("BillingStripeClientAdapter", "P2")],
        },
        {
          contextName: "y",
          adapters: [adapter("BillingStripeClientAdapter2", "P3")],
        },
        {
          contextName: "billing",
          adapters: [adapter("StripeClientAdapter", "P4")],
        },
      ],
    };
    const result = dedupeAdapterNames(input);
    assert.strictEqual(
      result.adapterBindings.contexts[3].adapters[0].name,
      "BillingStripeClientAdapter3",
    );
  });

  it("disambiguates a within-context duplicate (degenerate Stage-4 output)", () => {
    const input: AdapterBindings = {
      contexts: [
        {
          contextName: "billing",
          adapters: [
            adapter("StripeClientAdapter", "P1"),
            adapter("StripeClientAdapter", "P2"),
          ],
        },
      ],
    };
    const result = dedupeAdapterNames(input);
    const names = result.adapterBindings.contexts[0].adapters.map(
      (a) => a.name,
    );
    assert.deepStrictEqual(names, [
      "StripeClientAdapter",
      "BillingStripeClientAdapter",
    ]);
  });

  it("preserves `implements` — only the name changes", () => {
    const input: AdapterBindings = {
      contexts: [
        { contextName: "a", adapters: [adapter("Dup", "PortA")] },
        { contextName: "b", adapters: [adapter("Dup", "PortB")] },
      ],
    };
    const result = dedupeAdapterNames(input);
    assert.strictEqual(
      result.adapterBindings.contexts[1].adapters[0].implements,
      "PortB",
    );
  });

  it("produces globally-unique adapter names across all contexts", () => {
    const input: AdapterBindings = {
      contexts: [
        {
          contextName: "a",
          adapters: [adapter("Dup", "P1"), adapter("Other", "P2")],
        },
        { contextName: "b", adapters: [adapter("Dup", "P3")] },
        {
          contextName: "c",
          adapters: [adapter("Dup", "P4"), adapter("Other", "P5")],
        },
      ],
    };
    const result = dedupeAdapterNames(input);
    const allNames = result.adapterBindings.contexts.flatMap((c) =>
      c.adapters.map((a) => a.name),
    );
    assert.strictEqual(new Set(allNames).size, allNames.length);
  });
});
