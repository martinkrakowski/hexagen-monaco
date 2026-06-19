/**
 * @module governance-assistant.happy.test
 * @description Happy path tests for Governance Assistant user journey.
 *
 * Tests: User uploads manifest → scan completes (0 violations).
 * Verifies that governance can end-to-end validate a manifest and report compliance.
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
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
    registry = createMockRegistry();

    graphProviderAdapter = new MockArchitectureGraphProviderAdapter();
    linterAdapter = new MockLinterAdapter();
    manifestReaderAdapter = new MockManifestReaderAdapter();

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
    const validManifest = createGovernanceFixtureManifest();

    const start = performance.now();
    const result = await linterAdapter.lint(validManifest);
    const duration = performance.now() - start;

    assert.strictEqual(result.isCompliant, true);
    assert.strictEqual(result.violations.length, 0);

    assert.ok(duration < PERFORMANCE_TARGETS.LINTER.timeout);
  });

  it("happy path: returns parsed graph with no errors", async () => {
    const validManifest = createGovernanceFixtureManifest();

    const graph = await graphProviderAdapter.buildGraph(validManifest);

    assert.ok(graph !== undefined);
    assert.ok(graph.nodes !== undefined);
    assert.strictEqual(Array.isArray(graph.nodes), true);
    assert.ok(graph.nodes.length > 0);

    assert.ok(graph.edges !== undefined);
    assert.strictEqual(Array.isArray(graph.edges), true);

    graph.nodes.forEach((node) => {
      assert.ok("id" in node);
      assert.ok("name" in node);
      assert.ok("type" in node);
      assert.strictEqual(typeof node.id, "string");
      assert.strictEqual(typeof node.name, "string");
    });
  });

  it("happy path: manifest reader parses content successfully", async () => {
    const fixture = createGovernanceFixtureManifest();
    const manifestJson = JSON.stringify(fixture);

    const parsed = await manifestReaderAdapter.parseManifest(manifestJson);

    assert.ok(parsed !== undefined);
    assert.strictEqual(parsed.system, "test-hexagen-gov");
    assert.strictEqual(parsed.architecture, "modular-monolith");

    if ("bounded_contexts" in parsed) {
      assert.strictEqual(Array.isArray(parsed.bounded_contexts), true);
      const contexts = parsed.bounded_contexts as Array<{ name: string }>;
      assert.ok(contexts.length >= 5);
    }
  });

  it("happy path: compliance check reports 0 violations", async () => {
    const compliantManifest = createGovernanceFixtureManifest();

    const result = await linterAdapter.lint(compliantManifest);

    assert.strictEqual(result.isCompliant, true);
    assert.strictEqual(result.violations.length, 0);

    assert.strictEqual(Array.isArray(result.violations), true);
  });

  it("happy path: registry provides governance mocks", async () => {
    const graphProvider = getMockPort<MockArchitectureGraphProviderAdapter>(
      registry,
      PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
    );
    const linter = getMockPort<MockLinterAdapter>(registry, PORT_NAMES.LINTER);
    const manifestReader = getMockPort<MockManifestReaderAdapter>(
      registry,
      PORT_NAMES.MANIFEST_READER,
    );

    assert.ok(graphProvider !== undefined);
    assert.ok(linter !== undefined);
    assert.ok(manifestReader !== undefined);

    assert.strictEqual(typeof graphProvider.buildGraph, "function");
    assert.strictEqual(typeof linter.lint, "function");
    assert.strictEqual(typeof manifestReader.parseManifest, "function");
  });

  it("happy path: fixture manifest is valid and complete", async () => {
    const fixture = createGovernanceFixtureManifest();

    const parsed = await manifestReaderAdapter.parseManifest(
      JSON.stringify(fixture),
    );

    assert.ok("system" in parsed);
    assert.ok("scope" in parsed);
    assert.ok("architecture" in parsed);
    assert.ok("bounded_contexts" in parsed);
    assert.ok("generator" in parsed);

    const boundedContexts = (parsed as Record<string, unknown>)
      .bounded_contexts as Array<Record<string, unknown>>;
    assert.strictEqual(Array.isArray(boundedContexts), true);

    boundedContexts.forEach((bc: Record<string, unknown>) => {
      assert.ok("name" in bc);
      assert.ok("type" in bc);
      assert.ok("description" in bc);
      assert.ok("layers" in bc);

      const layers = bc.layers;
      assert.ok("domain" in (layers as object));
      assert.ok("application" in (layers as object));
      assert.ok("infrastructure" in (layers as object));
    });
  });

  it("happy path: performance targets are met", async () => {
    const manifest = createGovernanceFixtureManifest();
    const { timeout, targetMs } = PERFORMANCE_TARGETS.LINTER;

    const startTime = performance.now();
    const result = await linterAdapter.lint(manifest);
    const duration = performance.now() - startTime;

    assert.strictEqual(result.isCompliant, true);

    assert.ok(duration < timeout);

    console.log(
      `Linter scan duration: ${duration.toFixed(2)}ms (target: ${targetMs}ms)`,
    );
  });
});
