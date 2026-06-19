import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractSpecSummary,
  describeFindings,
  isAutoAppliedNotice,
} from "../utils";

describe("extractSpecSummary", () => {
  test("happy path with valid spec data and structures", () => {
    const validSpec = {
      bounded_contexts: [
        {
          name: "Inventory",
          aggregates: [
            { name: "Product", root: true },
            { name: "StockItem", root: false },
          ],
          value_objects: [{ name: "Sku" }, { name: "Weight" }],
        },
        {
          name: "Shipping",
          aggregates: [{ name: "Shipment" }],
          value_objects: [],
        },
      ],
      use_cases: {
        Inventory: [{ name: "CreateProduct" }, { name: "UpdateStock" }],
        Shipping: [{ name: "ShipOrder" }],
      },
      context_mappings: [{ downstream: "Shipping", upstream: "Inventory" }],
      event_bus: {
        subscriptions: [{ event: "ProductCreated", handler: "SyncProduct" }],
      },
    };

    const summary = extractSpecSummary(validSpec);
    assert.deepEqual(summary, {
      contextCount: 2,
      aggregateCount: 2, // StockItem has root: false (filtered out), Shipment defaults to root: true/undefined, Product has root: true
      valueObjectCount: 2,
      useCaseCount: 3,
      mappingCount: 1,
      eventBusSubscriptionCount: 1,
    });
  });

  test("missing fields (empty object passed)", () => {
    const emptySpec = {};
    const summary = extractSpecSummary(emptySpec);
    assert.deepEqual(summary, {
      contextCount: 0,
      aggregateCount: 0,
      valueObjectCount: 0,
      useCaseCount: 0,
      mappingCount: 0,
      eventBusSubscriptionCount: 0,
    });
  });

  test("malformed/invalid shapes", () => {
    const malformedSpec = {
      bounded_contexts: "not-an-array",
      use_cases: 12345,
      context_mappings: {},
      event_bus: "not-an-object",
    };

    const summary = extractSpecSummary(malformedSpec);
    assert.deepEqual(summary, {
      contextCount: 0,
      aggregateCount: 0,
      valueObjectCount: 0,
      useCaseCount: 0,
      mappingCount: 0,
      eventBusSubscriptionCount: 0,
    });
  });

  test("malformed inner shapes", () => {
    const malformedInner = {
      bounded_contexts: [
        {
          name: "Context1",
          aggregates: "not-an-array",
          value_objects: 123,
        },
        {
          name: "Context2",
          aggregates: [{ name: "Agg1", root: true }],
          value_objects: ["VO1"],
        },
      ],
      use_cases: {
        Context1: "not-an-array",
        Context2: [{ name: "UseCase1" }],
      },
      event_bus: {
        subscriptions: "not-an-array",
      },
    };

    const summary = extractSpecSummary(malformedInner);
    assert.deepEqual(summary, {
      contextCount: 2,
      aggregateCount: 1,
      valueObjectCount: 1,
      useCaseCount: 1,
      mappingCount: 0,
      eventBusSubscriptionCount: 0,
    });
  });
});

describe("describeFindings", () => {
  test("errors only — pluralizes, omits warnings", () => {
    assert.equal(describeFindings(3, 0), "3 issues");
    assert.equal(describeFindings(1, 0), "1 issue");
  });

  test("warnings only — no '0 issues' prefix (the 6a copy edge)", () => {
    assert.equal(describeFindings(0, 2), "2 warnings");
    assert.equal(describeFindings(0, 1), "1 warning");
  });

  test("both — joined with 'and', each pluralized independently", () => {
    assert.equal(describeFindings(3, 2), "3 issues and 2 warnings");
    assert.equal(describeFindings(1, 1), "1 issue and 1 warning");
  });
});

describe("isAutoAppliedNotice", () => {
  test("matches the R12 adapter-rename advisory", () => {
    assert.equal(
      isAutoAppliedNotice(
        "Renamed adapter 'StripeClientAdapter' in context 'InvoicingBilling' to 'InvoicingBillingStripeClientAdapter' to keep adapter names globally unique (R12).",
      ),
      true,
    );
  });

  test("matches the R03 repository-port synthesis advisory", () => {
    assert.equal(
      isAutoAppliedNotice(
        "Auto-added a default repository port 'InvoiceRepositoryPort' and adapter 'InvoiceRepositoryAdapter' to context 'invoicing-billing' — Stage 3 produced no outbound repository port (R03). Review and rename to fit your domain.",
      ),
      true,
    );
  });

  test("does NOT match a real reviewer finding (even one mentioning a rule)", () => {
    assert.equal(
      isAutoAppliedNotice(
        "[R16] Port 'CreateInvoicePort' description is trivial.",
      ),
      false,
    );
    assert.equal(
      isAutoAppliedNotice(
        "Context 'invoicing-billing' publishes events but has no publisher port.",
      ),
      false,
    );
  });
});
