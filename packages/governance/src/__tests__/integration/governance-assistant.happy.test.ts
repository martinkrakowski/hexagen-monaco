/**
 * @module governance-assistant.happy.test
 * @description Happy path tests for Governance Assistant user journey.
 *
 * Tests: User uploads manifest → scan completes (0 violations).
 * Verifies that governance can end-to-end validate a manifest and report compliance.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockRegistry,
  registerMockPort,
  getMockPort,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock.ts";
import {
  MockArchitectureGraphProviderAdapter,
  MockLinterAdapter,
  MockManifestReaderAdapter,
  createGovernanceFixtureManifest,
} from "../fixtures/governance-mocks";
import {
  PORT_NAMES,
  PERFORMANCE_TARGETS,
} from "../../../../web-driver/src/infrastructure/constants/index.ts";

describe("Governance Assistant — Happy Path", () => {
  let registry: PortRegistry;
  let graphProviderAdapter: MockArchitectureGraphProviderAdapter;
  let linterAdapter: MockLinterAdapter;
  let manifestReaderAdapter: MockManifestReaderAdapter;

  beforeEach(() => {
    // Create fresh registry for each test
    registry = createMockRegistry();

    // Create mock adapters (fresh instances per test)
    graphProviderAdapter = new MockArchitectureGraphProviderAdapter();
    linterAdapter = new MockLinterAdapter();
    manifestReaderAdapter = new MockManifestReaderAdapter();

    // Register mocks in registry with compile-time type safety
    registerMockPort(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
      graphProviderAdapter,
    );
    registerMockPort(registry, PORT_NAMES.LINTER, linterAdapter);
    registerMockPort(
      registry,
      PORT_NAMES.MANIFEST_READER,
      manifestReaderAdapter,
    );
  });

  it("happy path: scans valid manifest, reports compliant", async () => {
    // Arrange: Create a valid manifest
    const validManifest = createGovernanceFixtureManifest();

    // Act: Run linting scan
    const start = performance.now();
    const result = await linterAdapter.lint(validManifest);
    const duration = performance.now() - start;

    // Assert: Verify success and compliance
    expect(result.isCompliant).toBe(true);
    expect(result.violations).toHaveLength(0);

    // Verify performance target (should be very fast in mock)
    expect(duration).toBeLessThan(PERFORMANCE_TARGETS.LINTER.timeout);
  });

  it("happy path: returns parsed graph with no errors", async () => {
    // Arrange: Create a valid manifest
    const validManifest = createGovernanceFixtureManifest();

    // Act: Build architecture graph
    const graph = await graphProviderAdapter.buildGraph(validManifest);

    // Assert: Verify graph structure
    expect(graph).toBeDefined();
    expect(graph.nodes).toBeDefined();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);

    // Verify edges exist
    expect(graph.edges).toBeDefined();
    expect(Array.isArray(graph.edges)).toBe(true);

    // Verify node structure
    graph.nodes.forEach((node) => {
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("name");
      expect(node).toHaveProperty("type");
      expect(typeof node.id).toBe("string");
      expect(typeof node.name).toBe("string");
    });
  });

  it("happy path: manifest reader parses content successfully", async () => {
    // Arrange: Create fixture manifest as JSON string
    const fixture = createGovernanceFixtureManifest();
    const manifestJson = JSON.stringify(fixture);

    // Act: Parse manifest
    const parsed = await manifestReaderAdapter.parseManifest(manifestJson);

    // Assert: Verify parsing succeeded
    expect(parsed).toBeDefined();
    expect(parsed.system).toBe("test-hexagen-gov");
    expect(parsed.architecture).toBe("modular-monolith");

    // Verify bounded contexts were parsed
    if ("bounded_contexts" in parsed) {
      expect(Array.isArray(parsed.bounded_contexts)).toBe(true);
      const contexts = parsed.bounded_contexts as Array<{ name: string }>;
      expect(contexts.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("happy path: compliance check reports 0 violations", async () => {
    // Arrange: Create a valid, compliant manifest
    const compliantManifest = createGovernanceFixtureManifest();

    // Act: Run full compliance check
    const result = await linterAdapter.lint(compliantManifest);

    // Assert: Verify compliance
    expect(result.isCompliant).toBe(true);
    expect(result.violations).toHaveLength(0);

    // Verify violations array is well-formed
    expect(Array.isArray(result.violations)).toBe(true);
  });

  it("happy path: registry provides governance mocks", async () => {
    // Arrange: All mocks are registered above

    // Act: Retrieve mocks from registry using type-safe constants
    const graphProvider = getMockPort<MockArchitectureGraphProviderAdapter>(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
    );
    const linter = getMockPort<MockLinterAdapter>(registry, PORT_NAMES.LINTER);
    const manifestReader = getMockPort<MockManifestReaderAdapter>(
      registry,
      PORT_NAMES.MANIFEST_READER,
    );

    // Assert: All mocks are available
    expect(graphProvider).toBeDefined();
    expect(linter).toBeDefined();
    expect(manifestReader).toBeDefined();

    // Verify they're the right types
    expect(typeof graphProvider.buildGraph).toBe("function");
    expect(typeof linter.lint).toBe("function");
    expect(typeof manifestReader.parseManifest).toBe("function");
  });

  it("happy path: fixture manifest is valid and complete", async () => {
    // Arrange: Load fixture manifest
    const fixture = createGovernanceFixtureManifest();

    // Act: Parse and validate structure
    const parsed = await manifestReaderAdapter.parseManifest(
      JSON.stringify(fixture),
    );

    // Assert: Verify all required fields
    expect(parsed).toHaveProperty("system");
    expect(parsed).toHaveProperty("scope");
    expect(parsed).toHaveProperty("architecture");
    expect(parsed).toHaveProperty("bounded_contexts");
    expect(parsed).toHaveProperty("generator");

    // Verify bounded contexts have proper structure
    const boundedContexts = (parsed as Record<string, unknown>)
      .bounded_contexts as Array<Record<string, unknown>>;
    expect(Array.isArray(boundedContexts)).toBe(true);

    boundedContexts.forEach((bc: Record<string, unknown>) => {
      expect(bc).toHaveProperty("name");
      expect(bc).toHaveProperty("type");
      expect(bc).toHaveProperty("description");
      expect(bc).toHaveProperty("layers");

      // Verify layers structure
      const layers = bc.layers;
      expect(layers).toHaveProperty("domain");
      expect(layers).toHaveProperty("application");
      expect(layers).toHaveProperty("infrastructure");
    });
  });

  it("happy path: performance targets are met", async () => {
    // Arrange: Create a manifest
    const manifest = createGovernanceFixtureManifest();
    const { timeout, targetMs } = PERFORMANCE_TARGETS.LINTER;

    // Act: Run linting with performance measurement
    const startTime = performance.now();
    const result = await linterAdapter.lint(manifest);
    const duration = performance.now() - startTime;

    // Assert: Verify performance
    expect(result.isCompliant).toBe(true);

    // Should complete well within timeout
    expect(duration).toBeLessThan(timeout);

    // For happy path (0 violations), should be very fast
    // (target is soft limit for logging purposes)
    console.log(
      `Linter scan duration: ${duration.toFixed(2)}ms (target: ${targetMs}ms)`,
    );
  });
});
