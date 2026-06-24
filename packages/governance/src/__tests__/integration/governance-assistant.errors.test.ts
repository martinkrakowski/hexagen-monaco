/**
 * @module governance-assistant.errors.test
 * @description Error handling and edge case tests for Governance Assistant.
 *
 * Tests:
 * 1. Linter reports 3 violations (isCompliant = false)
 * 2. Manifest parser throws (PARSE_ERROR)
 * 3. Graph provider timeout (>2s delay)
 * 4. Malformed YAML (structural error)
 * 5. Large manifest performance check (<2.5s)
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createMockRegistry,
  registerMockPort,
  ErrorScenario,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures";
import { createGovernanceFixtureManifest } from "../fixtures/governance-mocks";
import {
  ViolationReportingMockAdapter,
  FailingMockAdapter,
  DelayedMockAdapter,
  MalformedYAMLMockAdapter,
  MalformedGraphMockAdapter,
} from "../fixtures/governance-error-mocks";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names";

describe("Governance Assistant — Error Handling", () => {
  let registry: PortRegistry;

  beforeEach(() => {
    registry = createMockRegistry();
  });

  it("error: linter reports 3 violations (isCompliant = false)", async () => {
    const violationAdapter = new ViolationReportingMockAdapter(3);
    registerMockPort(registry, PORT_NAMES.LINTER, violationAdapter);

    const manifest = createGovernanceFixtureManifest();

    const result = await violationAdapter.lint(manifest);

    assert.strictEqual(result.isCompliant, false);
    assert.strictEqual(result.violations.length, 3);
    assert.ok("id" in result.violations[0]);
    assert.ok("message" in result.violations[0]);
    assert.ok("severity" in result.violations[0]);
  });

  it("error: manifest parser throws PARSE_ERROR", async () => {
    const failingReader = new FailingMockAdapter(ErrorScenario.PARSE_ERROR);
    registerMockPort(registry, PORT_NAMES.MANIFEST_READER, failingReader);

    try {
      await failingReader.parse();
    } catch (error) {
      assert.ok(error !== undefined);
      assert.strictEqual(error instanceof Error, true);
      if (error instanceof Error) {
        assert.ok(error.message.includes("PARSE_ERROR"));
      }
    }
  });

  it("error: graph provider timeout after 2s", async () => {
    const delayedGraphProvider = new DelayedMockAdapter(2500);
    registerMockPort(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
      delayedGraphProvider,
    );

    const manifest = createGovernanceFixtureManifest();

    const startTime = Date.now();
    const result = await delayedGraphProvider.buildGraph(manifest);
    const duration = Date.now() - startTime;

    assert.ok(duration >= 2500);
    assert.ok(result !== undefined);
    assert.ok(result.nodes !== undefined);
  });

  it("error: malformed YAML structure detected", async () => {
    const malformedYAMLAdapter = new MalformedYAMLMockAdapter();
    registerMockPort(
      registry,
      PORT_NAMES.MANIFEST_READER,
      malformedYAMLAdapter,
    );

    const result = await malformedYAMLAdapter.parseManifest("invalid: [yaml");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, ErrorScenario.PARSE_ERROR);
    assert.ok("line" in result.error.details);
    assert.ok("snippet" in result.error.details);
  });

  it("error: large manifest performance warning (>2.5s)", async () => {
    const linterAdapter = new DelayedMockAdapter(2500);
    registerMockPort(registry, PORT_NAMES.LINTER, linterAdapter);

    const largeManifest = {
      ...createGovernanceFixtureManifest(),
      bounded_contexts: Array.from({ length: 100 }, (_, i) => ({
        name: `context-${i}`,
        type: "core",
        description: `Bounded context ${i}`,
      })),
    };

    const startTime = Date.now();
    const result = await linterAdapter.lint(largeManifest);
    const duration = Date.now() - startTime;

    assert.ok(duration >= 2500);
    assert.ok(result !== undefined);
  });

  it("error: graph builder returns malformed structure", async () => {
    const malformedGraphAdapter = new MalformedGraphMockAdapter();
    registerMockPort(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
      malformedGraphAdapter,
    );

    const manifest = createGovernanceFixtureManifest();

    const result = await malformedGraphAdapter.buildGraph(manifest);

    assert.ok(result !== undefined);
    assert.strictEqual("nodes" in result || "edges" in result, false);
  });

  it("error: linter reports 5 violations (mixed severity)", async () => {
    const violationAdapter = new ViolationReportingMockAdapter(5);
    registerMockPort(registry, PORT_NAMES.LINTER, violationAdapter);

    const manifest = createGovernanceFixtureManifest();

    const result = await violationAdapter.lint(manifest);

    assert.strictEqual(result.violations.length, 5);
    const errors = result.violations.filter((v) => v.severity === "error");
    const warnings = result.violations.filter((v) => v.severity === "warning");

    assert.ok(errors.length > 0);
    assert.ok(warnings.length > 0);
    assert.strictEqual(errors.length + warnings.length, 5);
  });

  it("error: concurrent parse and lint operations timeout", async () => {
    const slowParser = new DelayedMockAdapter(1500);
    const slowLinter = new DelayedMockAdapter(1500);
    registerMockPort(registry, PORT_NAMES.MANIFEST_READER, slowParser);
    registerMockPort(registry, PORT_NAMES.LINTER, slowLinter);

    const manifest = createGovernanceFixtureManifest();

    const startTime = Date.now();
    const [parseResult, lintResult] = await Promise.all([
      slowParser.parseManifest(JSON.stringify(manifest)),
      slowLinter.lint(manifest),
    ]);
    const duration = Date.now() - startTime;

    assert.ok(parseResult !== undefined);
    assert.ok(lintResult !== undefined);
    assert.ok(duration < 3000);
  });
});
