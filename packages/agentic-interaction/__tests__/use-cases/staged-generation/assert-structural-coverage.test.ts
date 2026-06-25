import { test } from "vitest";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStructuredConfig } from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import {
  assertStructuralCoverage,
  KRAKOWSKI_BASELINE_EXPECTATIONS,
} from "./fixtures/assert-structural-coverage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test("krakowski-portal.yaml conforms to baseline schema", () => {
  const yamlPath = join(__dirname, "fixtures", "krakowski-portal.yaml");
  const rawConfig = readFileSync(yamlPath, "utf8");
  const config = parseStructuredConfig(rawConfig);

  // Structural-coverage minimums (shared with conversion-output verification).
  assertStructuralCoverage(config, KRAKOWSKI_BASELINE_EXPECTATIONS);

  // Fixture-specific exact counts — these pin what the SOURCE looks like,
  // distinct from the minimum-coverage guarantees the helper enforces.
  assert.strictEqual(
    config.bounded_contexts.length,
    7,
    "canonical fixture must have exactly 7 contexts",
  );
  assert.strictEqual(
    config.apps?.length ?? 0,
    0,
    "canonical fixture has no apps",
  );
  assert.strictEqual(
    config.context_mappings?.length ?? 0,
    14,
    "canonical fixture has exactly 14 context mappings",
  );

  const identityAccess = config.bounded_contexts.find(
    (c) => c.name === "IdentityAccess",
  );
  assert.ok(identityAccess);
  assert.strictEqual(
    identityAccess.aggregates?.length,
    2,
    "IdentityAccess has 2 aggregates (User root + OnboardingState entity)",
  );

  const invoicingBilling = config.bounded_contexts.find(
    (c) => c.name === "InvoicingBilling",
  );
  assert.ok(invoicingBilling);
  assert.strictEqual(invoicingBilling.value_objects?.length, 1);
});
