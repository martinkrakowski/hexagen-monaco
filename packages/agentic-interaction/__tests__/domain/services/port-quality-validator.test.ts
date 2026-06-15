import { test, describe } from "node:test";
import assert from "node:assert";
import { validatePortQuality } from "../../../src/domain/services/port-quality-validator.ts";
import type { PortDefinition } from "../../../src/domain/value-objects/pipeline-state";

describe("validatePortQuality", () => {
  const goodPort: PortDefinition = {
    name: "OrderRepositoryPort",
    type: "repository",
    description:
      "Provides persistent storage for order aggregates across checkout and fulfillment",
    forAggregate: "Order",
    justification:
      "Order aggregate requires persistent storage for order state across checkout and fulfillment workflows",
  };
  const aggregateRoots = ["Order", "Customer", "Product"];

  test("good port produces no issues", () => {
    const issues = validatePortQuality(
      [goodPort],
      "OrderContext",
      aggregateRoots,
    );
    assert.strictEqual(issues.length, 0);
  });

  test("trivial description → warning R16", () => {
    const port: PortDefinition = {
      name: "OrderRepositoryPort",
      type: "repository",
      description: "Repo",
      forAggregate: "Order",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.ok(issues.some((i) => i.rule === "R16" && i.severity === "warning"));
  });

  test("description that is a substring of the port name → warning R16", () => {
    const port: PortDefinition = {
      name: "OrderRepositoryPort",
      type: "repository",
      description: "OrderRepository",
      forAggregate: "Order",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.ok(issues.some((i) => i.rule === "R16" && i.severity === "warning"));
  });

  test("invalid forAggregate → error R17", () => {
    const port: PortDefinition = {
      name: "FooRepositoryPort",
      type: "repository",
      description:
        "Provides persistence for foo aggregates in the order domain",
      forAggregate: "NonExistent",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.ok(issues.some((i) => i.rule === "R17" && i.severity === "error"));
  });

  test("degenerate justification → warning", () => {
    const port: PortDefinition = {
      name: "OrderRepositoryPort",
      type: "repository",
      description:
        "Provides persistent storage for order aggregates across checkout and fulfillment",
      justification: "Repository",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.ok(
      issues.some(
        (i) =>
          i.rule === "R16" &&
          i.severity === "warning" &&
          i.message.includes("justification"),
      ),
    );
  });

  test("infrastructure name with platform token → error R18 (regex)", () => {
    const port: PortDefinition = {
      name: "VercelClientPort",
      type: "external-client",
      description: "Provides client integration for Vercel deployment platform",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.ok(issues.some((i) => i.rule === "R18" && i.severity === "error"));
  });

  test("infrastructure name with FlyIO → error R18 (regex)", () => {
    const port: PortDefinition = {
      name: "FlyIOClientAdapter",
      type: "external-client",
      description:
        "Client adapter for FlyIO deployment platform infrastructure",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.ok(issues.some((i) => i.rule === "R18" && i.severity === "error"));
  });

  test("runtime concern leak: EmailRetryPort with email-retry concern → error R18", () => {
    const port: PortDefinition = {
      name: "EmailRetryPort",
      type: "notifier",
      description: "Handles email retry logic for notification dispatch",
    };
    const issues = validatePortQuality(
      [port],
      "NotificationContext",
      aggregateRoots,
      ["email-retry"],
    );
    assert.ok(issues.some((i) => i.rule === "R18" && i.severity === "error"));
  });

  test("runtime concern leak: OverdueInvoiceDetectionPort with overdue-invoice concern → error R18", () => {
    const port: PortDefinition = {
      name: "OverdueInvoiceDetectionPort",
      type: "command",
      description:
        "Detects overdue invoices for automated follow-up processing",
    };
    const issues = validatePortQuality(
      [port],
      "BillingContext",
      aggregateRoots,
      ["overdue-invoice-detection"],
    );
    assert.ok(issues.some((i) => i.rule === "R18" && i.severity === "error"));
  });

  test("domain ports sharing ONE noun with a multi-word concern are NOT flagged (R18 false-positive guard)", () => {
    // The bug: 'invoice'/'event'/'email' are domain nouns that ALSO appear as
    // single tokens inside 'overdue-invoice-detection'/'event-bus'/'email-retry'.
    // The old "any single shared token" rule flagged every domain port; the fix
    // requires the port to be NAMED AFTER the concern (>=2 contiguous tokens).
    const cases: Array<[string, string]> = [
      ["CreateInvoicePort", "overdue-invoice-detection"],
      ["InvoiceRepository", "overdue-invoice-detection"],
      ["UserEventPublisher", "event-bus"],
      ["EmailNotifierPort", "email-retry"],
    ];
    for (const [name, concern] of cases) {
      const port: PortDefinition = {
        name,
        type: "command",
        description:
          "Accepts requests from upstream and coordinates the domain workflow",
      };
      const issues = validatePortQuality([port], "Ctx", aggregateRoots, [
        concern,
      ]);
      assert.ok(
        !issues.some((i) => i.rule === "R18"),
        `${name} must NOT be R18 for "${concern}" (shares only one token)`,
      );
    }
  });

  test("runtime concern leak: FlyIO in deployment concerns → error R18", () => {
    const port: PortDefinition = {
      name: "FlyIOClientPort",
      type: "external-client",
      description:
        "Client adapter for FlyIO deployment platform infrastructure",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots, [
      "fly.io",
    ]);
    assert.ok(issues.some((i) => i.rule === "R18" && i.severity === "error"));
  });

  test("no justification → no issue (justification is optional)", () => {
    const port: PortDefinition = {
      name: "OrderRepositoryPort",
      type: "repository",
      description:
        "Provides persistent storage for order aggregates across checkout and fulfillment",
      forAggregate: "Order",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots);
    assert.strictEqual(issues.length, 0);
  });

  test("runtimeConcerns undefined → only regex backstop runs", () => {
    const port: PortDefinition = {
      name: "EmailRetryPort",
      type: "notifier",
      description: "Handles email retry logic for notification dispatch",
    };
    const issues = validatePortQuality(
      [port],
      "NotificationContext",
      aggregateRoots,
    );
    const r14 = issues.filter((i) => i.rule === "R18");
    assert.strictEqual(
      r14.length,
      0,
      "R18 should not fire without runtimeConcerns when regex backstop doesn't match",
    );
  });

  test("port with non-matching runtime concern → no R18 leak", () => {
    const port: PortDefinition = {
      name: "OrderRepositoryPort",
      type: "repository",
      description:
        "Provides persistent storage for order aggregates across checkout and fulfillment",
      forAggregate: "Order",
    };
    const issues = validatePortQuality([port], "OrderContext", aggregateRoots, [
      "email-retry",
      "cron-scheduler",
    ]);
    assert.ok(!issues.some((i) => i.rule === "R18"));
  });

  test("multiple ports can produce multiple distinct issues", () => {
    const ports: PortDefinition[] = [
      {
        name: "VercelClientPort",
        type: "external-client",
        description:
          "Client for Vercel platform integration and deployment hooks",
        forAggregate: "NonExistent",
      },
      {
        name: "GoodPort",
        type: "repository",
        description:
          "Provides persistent storage for order aggregates across checkout and fulfillment",
        forAggregate: "Order",
      },
    ];
    const issues = validatePortQuality(ports, "Ctx", aggregateRoots, [
      "vercel-hosting",
    ]);
    assert.ok(
      issues.length >= 2,
      "Expected at least 2 issues from the bad port",
    );
  });

  test("empty ports array → no issues", () => {
    const issues = validatePortQuality([], "Ctx", aggregateRoots, [
      "email-retry",
    ]);
    assert.strictEqual(issues.length, 0);
  });

  test("StripeReconciliationPort with stripe-reconciliation concern → error R18", () => {
    const port: PortDefinition = {
      name: "StripeReconciliationPort",
      type: "command",
      description: "Reconciles Stripe payments with internal billing records",
    };
    const issues = validatePortQuality(
      [port],
      "BillingContext",
      aggregateRoots,
      ["stripe-reconciliation"],
    );
    assert.ok(issues.some((i) => i.rule === "R18" && i.severity === "error"));
  });
});
