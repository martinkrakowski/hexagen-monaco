import { test, describe } from "node:test";
import assert from "node:assert";
import {
  inferInboundPortType,
  inferOutboundPortType,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

// These name→type inferences are load-bearing for Stage-7 manifest repair: the
// re-validation rebuilds the port map from a NAME-ONLY manifest, so the port
// TYPE is derived here from the name alone (B1a in
// docs/planning/stage7-repair-rca-and-remediation.md). An R03 "add a repository
// port" fix only clears the rule if a `…Repository` name classifies as
// `repository` without any Stage-3 type field.

describe("inferOutboundPortType (name-only)", () => {
  test("a `…Repository` name → repository (the R03 linchpin)", () => {
    assert.strictEqual(
      inferOutboundPortType("UserRepositoryPort"),
      "repository",
    );
    assert.strictEqual(
      inferOutboundPortType("InvoiceRepositoryPort"),
      "repository",
    );
    assert.strictEqual(inferOutboundPortType("OrderRepo"), "repository");
  });

  test("publisher / notifier names classify accordingly", () => {
    assert.strictEqual(
      inferOutboundPortType("DomainEventPublisherPort"),
      "publisher",
    );
    assert.strictEqual(inferOutboundPortType("EmailNotifierPort"), "notifier");
  });

  test("a `Report…` name is NOT misread as a repository (the bare 'repo' shorthand must be a trailing token)", () => {
    // "report".includes("repo") was the over-match: ReportPublisherPort wrongly
    // classified as repository because the repo check ran (and won) before the
    // publisher check (PR #344 review).
    assert.strictEqual(
      inferOutboundPortType("ReportPublisherPort"),
      "publisher",
    );
    assert.strictEqual(
      inferOutboundPortType("ReportingClientPort"),
      "external-client",
    );
    // …but a genuine trailing Repo shorthand still classifies as a repository.
    assert.strictEqual(inferOutboundPortType("OrderRepoPort"), "repository");
  });

  test("anything else → external-client (default)", () => {
    assert.strictEqual(
      inferOutboundPortType("StripeClientPort"),
      "external-client",
    );
  });
});

describe("inferInboundPortType (name-only)", () => {
  test("event / query / command classify from the name", () => {
    assert.strictEqual(inferInboundPortType("OrderCreatedEventPort"), "event");
    assert.strictEqual(inferInboundPortType("GetUserPort"), "query");
    assert.strictEqual(inferInboundPortType("FindOrdersPort"), "query");
    assert.strictEqual(inferInboundPortType("ListInvoicesPort"), "query");
    assert.strictEqual(inferInboundPortType("RegisterUserPort"), "command");
  });
});
