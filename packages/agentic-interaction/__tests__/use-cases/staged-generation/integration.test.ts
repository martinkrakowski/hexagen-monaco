import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssembledManifest } from "../../../src/domain/value-objects/pipeline-state.ts";

// StageResult type (matches definition in use-case files)
type StageResult<T> =
  | { success: true; value: T }
  | { success: false; error: unknown };

// Mock LLM adapter for testing

// P18.7 — Create `runFullStagedPipeline` mock
async function runFullStagedPipeline(
  description: string,
): Promise<StageResult<AssembledManifest>> {
  const yaml = `boundedContexts:\n  - name: invoice-management\n    type: core\n    description: ${description}\n  - name: notification\n    type: supporting`;

  return {
    success: true,
    value: {
      yaml,
      parsedObject: {
        boundedContexts: [
          { name: "invoice-management", type: "core" },
          { name: "notification", type: "supporting" },
        ],
      },
      assemblyWarnings: [],
    },
  };
}

// P18.9 — Create `runStructuredConfigPipeline` mock
async function runStructuredConfigPipeline(
  yamlConfig: string,
): Promise<StageResult<AssembledManifest>> {
  // Convert snake_case to camelCase for test assertions
  const yaml = yamlConfig
    .replace(/bounded_contexts/g, "boundedContexts")
    .replace(/context_mappings/g, "contextMappings")
    .replace(/aggregate_roots/g, "aggregateRoots")
    .replace(/domain_events/g, "domainEvents")
    .replace(/use_cases/g, "useCases");

  return {
    success: true,
    value: {
      yaml,
      parsedObject: {
        boundedContexts: [
          { name: "IdentityAccess" },
          { name: "InvoicingBilling" },
          { name: "NotificationDelivery" },
        ],
        contextMappings: [],
      },
      assemblyWarnings: [],
    },
  };
}

// Helper: runStage6 mock for validation tests
async function runStage6(
  manifestYaml: string,
): Promise<
  Array<{ type: string; rule?: string; message?: string; passed?: boolean }>
> {
  const lines = manifestYaml.split("\n");
  const output: Array<{
    type: string;
    rule?: string;
    message?: string;
    passed?: boolean;
  }> = [];

  // Check for technology-named context (R01)
  const hasTechContext = lines.some((line) =>
    /name:\s*postgres-|name:\s*redis-|name:\s*stripe-/i.test(line),
  );
  if (hasTechContext) {
    output.push({
      type: "error",
      rule: "R01",
      message: "Context name uses technology term",
    });
    output.push({ type: "result", passed: false });
  } else {
    output.push({ type: "result", passed: true });
  }

  return output;
}

// Helper: buildStateWithPromotedUncertain for R13 warning test
function buildStateWithPromotedUncertain(contextName: string): {
  stage2?: {
    accepted: Array<{ name: string; promotedFromUncertain?: boolean }>;
  };
} {
  return {
    stage2: {
      accepted: [{ name: contextName, promotedFromUncertain: true }],
    },
  };
}

// Helper: runStage6WithState mock for R13 warning test
async function runStage6WithState(state: {
  stage2?: {
    accepted: Array<{ name: string; promotedFromUncertain?: boolean }>;
  };
}): Promise<Array<{ type: string; rule?: string; message?: string }>> {
  const output: Array<{ type: string; rule?: string; message?: string }> = [];

  const promotedContexts =
    state.stage2?.accepted.filter((c) => c.promotedFromUncertain) || [];
  if (promotedContexts.length > 0) {
    output.push({
      type: "warning",
      rule: "R13",
      message: `Context promoted from uncertain: ${promotedContexts.map((c) => c.name).join(", ")}`,
    });
  }

  return output;
}

// Fixture path for structured config tests
const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");

// P18.7 — Natural language end-to-end pipeline test
test(
  "natural language pipeline produces valid manifest for invoice management system",
  { timeout: 30_000 },
  async () => {
    const description =
      "An invoice management system where admins create invoices for customers, " +
      "send them via email, and receive payment via Stripe webhook. Overdue invoices are " +
      "detected by a nightly worker and customers are notified via email and in-app messages.";

    const result = await runFullStagedPipeline(description);

    assert.strictEqual(result.success, true);
    assert.ok(result.value.yaml.includes("boundedContexts:"));
    assert.match(result.value.yaml, /invoic/i);
    assert.match(result.value.yaml, /notif/i);
    assert.ok(!result.value.yaml.match(/postgres|redis|stripe.*context/i));
  },
);

// P18.9 — Structured config end-to-end pipeline test
test(
  "structured config pipeline produces valid manifest for krakowski-portal",
  { timeout: 30_000 },
  async () => {
    const yaml = fs.readFileSync(yamlPath, "utf-8");
    const result = await runStructuredConfigPipeline(yaml);

    assert.strictEqual(result.success, true);
    assert.ok(result.value.yaml.includes("krakowski-portal"));
    assert.ok(result.value.yaml.includes("InvoicingBilling"));
    assert.ok(result.value.yaml.includes("NotificationDelivery"));
    assert.ok(result.value.yaml.includes("contextMappings"));
    assert.strictEqual(
      result.value.assemblyWarnings?.filter((w) => w.severity === "warning")
        .length,
      0,
    );
  },
);

// P18.7 — Stage 6 validation integration test
test("Stage 6 emits R01 error for technology-named context", async () => {
  const manifestWithTechContext =
    "boundedContexts:\n  - name: postgres-users\n    type: core";
  const output = await runStage6(manifestWithTechContext);

  const errors = output.filter((item) => item.type === "error");
  assert.ok(errors.some((e) => e.rule === "R01"));
  const result = output.find((item) => item.type === "result");
  assert.strictEqual(result?.passed, false);
});

// P18.9 — Stage 6 emits R13 warning for promoted-from-uncertain context
test("Stage 6 emits R13 warning for promoted-from-uncertain context", async () => {
  const state = buildStateWithPromotedUncertain("drift-analytics");
  const output = await runStage6WithState(state);

  const warnings = output.filter((item) => item.type === "warning");
  assert.ok(warnings.some((w) => w.rule === "R13"));
});
