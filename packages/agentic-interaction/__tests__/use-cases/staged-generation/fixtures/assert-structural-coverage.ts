import assert from "node:assert/strict";
import type { StructuredConfig } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

export interface CoverageExpectations {
  /** Required bounded-context names. Order does not matter. */
  contextNames: readonly string[];
  /** Required app names. Order does not matter. Omit to skip the apps check. */
  appNames?: readonly string[];
  /** Minimum number of context mappings (covers ≥). */
  minContextMappings?: number;
  /** Per-context: aggregate root names that MUST be present. */
  aggregateRootsByContext?: Readonly<Record<string, readonly string[]>>;
  /** Per-context: value-object names that MUST be present. */
  valueObjectsByContext?: Readonly<Record<string, readonly string[]>>;
  /** Per-context: use-case names that MUST be present. */
  useCasesByContext?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Assert that `config` preserves the structural coverage described by `expect`.
 * Designed for verifying that loose-spec conversion did not drop data.
 * Throws AssertionError with a descriptive message on the first failure.
 */
export function assertStructuralCoverage(
  config: StructuredConfig,
  expect: CoverageExpectations,
): void {
  // Contexts
  const actualContextNames = new Set(
    config.bounded_contexts.map((c) => c.name),
  );
  for (const required of expect.contextNames) {
    assert.ok(
      actualContextNames.has(required),
      `Missing bounded context "${required}". Got: [${[...actualContextNames].join(", ")}]`,
    );
  }

  // Apps
  if (expect.appNames) {
    const actualAppNames = new Set((config.apps ?? []).map((a) => a.name));
    for (const required of expect.appNames) {
      assert.ok(
        actualAppNames.has(required),
        `Missing app "${required}". Got: [${[...actualAppNames].join(", ")}]`,
      );
    }
  }

  // Context mappings (lower bound)
  if (typeof expect.minContextMappings === "number") {
    const actual = config.context_mappings?.length ?? 0;
    assert.ok(
      actual >= expect.minContextMappings,
      `Expected at least ${expect.minContextMappings} context mappings, got ${actual}.`,
    );
  }

  // Aggregate roots per context
  if (expect.aggregateRootsByContext) {
    for (const [ctxName, required] of Object.entries(
      expect.aggregateRootsByContext,
    )) {
      const ctx = config.bounded_contexts.find((c) => c.name === ctxName);
      assert.ok(ctx, `Cannot check aggregates: context "${ctxName}" missing.`);
      const aggNames = new Set(
        (ctx.aggregates ?? [])
          .filter((a) => a.root !== false)
          .map((a) => a.name),
      );
      for (const r of required) {
        assert.ok(
          aggNames.has(r),
          `Context "${ctxName}" missing aggregate root "${r}". Got: [${[...aggNames].join(", ")}]`,
        );
      }
    }
  }

  // Value objects per context
  if (expect.valueObjectsByContext) {
    for (const [ctxName, required] of Object.entries(
      expect.valueObjectsByContext,
    )) {
      const ctx = config.bounded_contexts.find((c) => c.name === ctxName);
      assert.ok(
        ctx,
        `Cannot check value_objects: context "${ctxName}" missing.`,
      );
      const voNames = new Set((ctx.value_objects ?? []).map((v) => v.name));
      for (const r of required) {
        assert.ok(
          voNames.has(r),
          `Context "${ctxName}" missing value object "${r}". Got: [${[...voNames].join(", ")}]`,
        );
      }
    }
  }

  // Use cases per context
  if (expect.useCasesByContext) {
    const useCasesMap = config.use_cases ?? {};
    for (const [ctxName, required] of Object.entries(
      expect.useCasesByContext,
    )) {
      const ucList = useCasesMap[ctxName] ?? [];
      const ucNames = new Set(ucList.map((u) => u.name));
      for (const r of required) {
        assert.ok(
          ucNames.has(r),
          `Context "${ctxName}" missing use case "${r}". Got: [${[...ucNames].join(", ")}]`,
        );
      }
    }
  }
}

/**
 * Expectations matching the canonical `krakowski-portal.yaml` fixture.
 * The loose-spec markdown variant must, at minimum, satisfy these.
 */
export const KRAKOWSKI_BASELINE_EXPECTATIONS: CoverageExpectations = {
  contextNames: [
    "IdentityAccess",
    "CustomerOnboarding",
    "InvoicingBilling",
    "PaymentProcessing",
    "NotificationDelivery",
    "ProjectDelivery",
    "ReportingAnalytics",
  ],
  minContextMappings: 14,
  aggregateRootsByContext: {
    IdentityAccess: ["User"],
    CustomerOnboarding: ["Customer"],
    InvoicingBilling: ["Invoice"],
    PaymentProcessing: ["Payment"],
    ProjectDelivery: ["Project"],
  },
  valueObjectsByContext: {
    InvoicingBilling: ["Money"],
  },
  useCasesByContext: {
    IdentityAccess: ["RegisterUser"],
  },
};
