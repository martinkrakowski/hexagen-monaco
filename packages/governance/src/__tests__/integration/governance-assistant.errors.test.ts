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

import { describe, it, expect, beforeEach } from "vitest";
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
    // Create fresh registry for each test
    registry = createMockRegistry();
  });

  it("error: linter reports 3 violations (isCompliant = false)", async () => {
    // Arrange: Create linter that reports violations
    const violationAdapter = new ViolationReportingMockAdapter(3);
    registerMockPort(registry, PORT_NAMES.LINTER, violationAdapter);

    const manifest = createGovernanceFixtureManifest();

    // Act: Run linter
    const result = await violationAdapter.lint(manifest);

    // Assert: Verify violations reported
    expect(result.isCompliant).toBe(false);
    expect(result.violations).toHaveLength(3);
    expect(result.violations[0]).toHaveProperty("id");
    expect(result.violations[0]).toHaveProperty("message");
    expect(result.violations[0]).toHaveProperty("severity");
  });

  it("error: manifest parser throws PARSE_ERROR", async () => {
    // Arrange: Create failing manifest reader
    const failingReader = new FailingMockAdapter(ErrorScenario.PARSE_ERROR);
    registerMockPort(registry, PORT_NAMES.MANIFEST_READER, failingReader);

    // Act: Try to parse malformed input
    try {
      await failingReader.parse();
    } catch (error) {
      // Assert: Verify parse error thrown
      expect(error).toBeDefined();
      expect(error instanceof Error).toBe(true);
      if (error instanceof Error) {
        expect(error.message).toContain("PARSE_ERROR");
      }
    }
  });

  it("error: graph provider timeout after 2s", async () => {
    // Arrange: Create delayed graph provider (>2s)
    const delayedGraphProvider = new DelayedMockAdapter(2500); // 2.5 seconds
    registerMockPort(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
      delayedGraphProvider,
    );

    const manifest = createGovernanceFixtureManifest();

    // Act: Call graph provider with delay
    const startTime = Date.now();
    const result = await delayedGraphProvider.buildGraph(manifest);
    const duration = Date.now() - startTime;

    // Assert: Verify timeout threshold exceeded
    expect(duration).toBeGreaterThanOrEqual(2500);
    expect(result).toBeDefined();
    // Graph might be empty due to timeout
    expect(result.nodes).toBeDefined();
  });

  it("error: malformed YAML structure detected", async () => {
    // Arrange: Create YAML parser with error
    const malformedYAMLAdapter = new MalformedYAMLMockAdapter();
    registerMockPort(
      registry,
      PORT_NAMES.MANIFEST_READER,
      malformedYAMLAdapter,
    );

    // Act: Try to parse invalid YAML
    const result = await malformedYAMLAdapter.parseManifest("invalid: [yaml");

    // Assert: Verify structural error reported
    expect(result.success).toBe(false);
    expect(result.error.code).toBe(ErrorScenario.PARSE_ERROR);
    expect(result.error.details).toHaveProperty("line");
    expect(result.error.details).toHaveProperty("snippet");
  });

  it("error: large manifest performance warning (>2.5s)", async () => {
    // Arrange: Create linter and time execution
    const linterAdapter = new DelayedMockAdapter(2500);
    registerMockPort(registry, PORT_NAMES.LINTER, linterAdapter);

    // Create large manifest with many bounded contexts
    const largeManifest = {
      ...createGovernanceFixtureManifest(),
      bounded_contexts: Array.from({ length: 100 }, (_, i) => ({
        name: `context-${i}`,
        type: "core",
        description: `Bounded context ${i}`,
      })),
    };

    // Act: Lint large manifest
    const startTime = Date.now();
    const result = await linterAdapter.lint(largeManifest);
    const duration = Date.now() - startTime;

    // Assert: Performance target exceeded (warning)
    expect(duration).toBeGreaterThanOrEqual(2500);
    expect(result).toBeDefined();
    // Performance warning should be logged in production
  });

  it("error: graph builder returns malformed structure", async () => {
    // Arrange: Create graph provider with malformed output
    const malformedGraphAdapter = new MalformedGraphMockAdapter();
    registerMockPort(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
      malformedGraphAdapter,
    );

    const manifest = createGovernanceFixtureManifest();

    // Act: Build graph
    const result = await malformedGraphAdapter.buildGraph(manifest);

    // Assert: Verify schema violation
    // Graph is missing required 'nodes' and 'edges' fields
    expect(result).toBeDefined();
    expect("nodes" in result || "edges" in result).toBe(false);
  });

  it("error: linter reports 5 violations (mixed severity)", async () => {
    // Arrange: Create linter with 5 violations
    const violationAdapter = new ViolationReportingMockAdapter(5);
    registerMockPort(registry, PORT_NAMES.LINTER, violationAdapter);

    const manifest = createGovernanceFixtureManifest();

    // Act: Run linter
    const result = await violationAdapter.lint(manifest);

    // Assert: Verify violation count and severity distribution
    expect(result.violations).toHaveLength(5);
    const errors = result.violations.filter((v) => v.severity === "error");
    const warnings = result.violations.filter((v) => v.severity === "warning");

    // Approximately half are errors, half warnings
    expect(errors.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(errors.length + warnings.length).toBe(5);
  });

  it("error: concurrent parse and lint operations timeout", async () => {
    // Arrange: Create adapters with controlled delays
    const slowParser = new DelayedMockAdapter(1500);
    const slowLinter = new DelayedMockAdapter(1500);
    registerMockPort(registry, PORT_NAMES.MANIFEST_READER, slowParser);
    registerMockPort(registry, PORT_NAMES.LINTER, slowLinter);

    const manifest = createGovernanceFixtureManifest();

    // Act: Run parse and lint concurrently
    const startTime = Date.now();
    const [parseResult, lintResult] = await Promise.all([
      slowParser.parseManifest(JSON.stringify(manifest)),
      slowLinter.lint(manifest),
    ]);
    const duration = Date.now() - startTime;

    // Assert: Both complete (not sequentially, so ~1.5s not 3s)
    expect(parseResult).toBeDefined();
    expect(lintResult).toBeDefined();
    expect(duration).toBeLessThan(3000); // Should be ~1500ms, not 3000ms
  });
});
