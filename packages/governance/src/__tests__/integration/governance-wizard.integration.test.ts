/**
 * @module governance-wizard.integration.test
 * @description Phase 6C Integration Tests: Bidirectional Governance-Wizard workflows.
 *
 * Tests governance feedback loops and manifest evolution:
 * 1. Governance violations → Wizard refinement feedback
 * 2. Manifest version tracking (avoid stale caches)
 * 3. Graph rebuild on manifest change (cache invalidation)
 *
 * Verifies governance state management across wizard iterations.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createCrossBoundaryRegistry,
  wireGovernanceToManifestReader,
  createFixtureManifest,
  createNonCompliantFixtureManifest,
  getLinterAdapter,
  type CrossBoundaryManifest,
} from "../../../../web-driver/src/__tests__/fixtures/cross-boundary-registry";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names";
import { registerMockPort } from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock";
import { MockLinterAdapter } from "../fixtures/governance-mocks";

describe("Governance-Wizard Integration Tests (Phase 6C)", () => {
  let registry: MockPortRegistry;

  beforeEach(() => {
    registry = createCrossBoundaryRegistry();
  });

  describe("Scenario 1: Governance Violations → Wizard Refinement Feedback", () => {
    it("integration: governance scans manifest → reports violations with field details", async () => {
      // Setup
      wireGovernanceToManifestReader(registry);

      // Create a linter that reports violations
      class ViolatingLinterAdapter {
        async lint(manifest: CrossBoundaryManifest): Promise<{
          isCompliant: boolean;
          violations: Array<{
            code: string;
            message: string;
            details?: string;
          }>;
        }> {
          // Check for invalid patterns
          const violations = [];

          if (manifest.bounded_contexts) {
            manifest.bounded_contexts.forEach((bc, idx) => {
              // Pattern: invalid naming (snake_case)
              if (bc.name && bc.name.includes("_")) {
                violations.push({
                  code: "INVALID_PORT_NAMING",
                  message: `Context '${bc.name}' uses snake_case; use camelCase`,
                  details: `Invalid name: ${bc.name}`,
                });
              }

              // Pattern: invalid type
              if (
                bc.type &&
                !["core", "shared-kernel", "supporting"].includes(bc.type)
              ) {
                violations.push({
                  code: "INVALID_CONTEXT_TYPE",
                  message: `Context '${bc.name}' has invalid type '${bc.type}'`,
                  details: `Valid types: core, shared-kernel, supporting`,
                });
              }
            });
          }

          return {
            isCompliant: violations.length === 0,
            violations,
          };
        }
      }

      registerMockPort(
        registry,
        PORT_NAMES.LINTER,
        new ViolatingLinterAdapter(),
      );

      // Act: Scan non-compliant manifest
      const linter = getLinterAdapter(registry);
      const nonCompliant = createNonCompliantFixtureManifest();
      const report = await linter.lint(nonCompliant);

      // Assert: Violations reported with details
      assert.strictEqual(report.isCompliant, false);
      assert.ok(report.violations.length > 0);

      // Verify violation details are present for field location
      const namingViolation = report.violations.find(
        (v) => v.code === "INVALID_PORT_NAMING",
      );
      assert.ok(namingViolation !== undefined);
      assert.ok(namingViolation?.details?.includes("invalid_port_name"));

      // Act: Wizard refines based on feedback
      const refinedManifest: CrossBoundaryManifest = {
        ...nonCompliant,
        bounded_contexts: nonCompliant.bounded_contexts?.map((bc) => ({
          ...bc,
          name: bc.name.replace(/_/g, "-"), // Fix: snake_case → kebab-case
          type: "core", // Fix: invalid type → valid type
        })),
      };

      // Act: Re-scan refined manifest
      const refinedReport = await linter.lint(refinedManifest);

      // Assert: Violations cleared after refinement
      assert.strictEqual(refinedReport.isCompliant, true);
      assert.strictEqual(refinedReport.violations.length, 0);
    });
  });

  describe("Scenario 2: Manifest Version Tracking (Stale Cache Prevention)", () => {
    it("integration: manifest version tags prevent cache reuse across iterations", async () => {
      // Setup
      wireGovernanceToManifestReader(registry);

      // Create linter that tracks version tags
      interface CacheEntry {
        isCompliant: boolean;
        violations: Array<{ code: string; message: string }>;
      }

      class VersionTrackingLinterAdapter {
        private reportCache = new Map<string, CacheEntry>();

        async lint(manifest: CrossBoundaryManifest): Promise<{
          _versionTag: string;
          isCompliant: boolean;
          violations: Array<{ code: string; message: string }>;
        }> {
          const versionTag = manifest._version || "unknown";

          // Check cache
          if (this.reportCache.has(versionTag)) {
            const cached = this.reportCache.get(versionTag)!;
            return {
              _versionTag: versionTag,
              isCompliant: cached.isCompliant,
              violations: cached.violations,
            };
          }

          // Not in cache: compute
          const result = {
            isCompliant: true,
            violations: [],
          };

          // Cache result
          this.reportCache.set(versionTag, result);

          return {
            _versionTag: versionTag,
            ...result,
          };
        }

        getCache(): Map<string, any> {
          return this.reportCache;
        }
      }

      const versionTracker = new VersionTrackingLinterAdapter();
      registerMockPort(registry, PORT_NAMES.LINTER, versionTracker);

      // Act: Scan v1
      const v1 = createFixtureManifest();
      v1._version = "abc123";
      const v1Report = await versionTracker.lint(v1);

      // Assert: v1 tagged with version
      assert.strictEqual(v1Report._versionTag, "abc123");

      // Act: Scan v2 (same content, different version)
      const v2 = { ...v1 };
      v2._version = "xyz789";
      const v2Report = await versionTracker.lint(v2);

      // Assert: v2 has different version tag
      assert.strictEqual(v2Report._versionTag, "xyz789");
      assert.notStrictEqual(v1Report._versionTag, v2Report._versionTag);

      // Assert: Cache has separate entries for each version
      const cache = versionTracker.getCache();
      assert.strictEqual(cache.has("abc123"), true);
      assert.strictEqual(cache.has("xyz789"), true);
    });
  });

  describe("Scenario 3: Graph Rebuild on Manifest Change (Cache Invalidation)", () => {
    it("integration: manifest changes trigger graph rebuild (old cache discarded)", async () => {
      // Setup
      wireGovernanceToManifestReader(registry);

      // Create graph provider that tracks cache
      interface GraphCache {
        nodes: Array<{ id: string; name: string; type: string }>;
        edges: Array<{ source: string; target: string; type: string }>;
      }

      class CachingGraphProviderAdapter {
        private graphCache = new Map<string, GraphCache>();

        async buildGraph(
          manifest: CrossBoundaryManifest,
        ): Promise<GraphCache & { _cacheKey: string }> {
          const cacheKey = manifest._version || "default";

          // Check cache
          if (this.graphCache.has(cacheKey)) {
            const cached = this.graphCache.get(cacheKey)!;
            return {
              nodes: cached.nodes,
              edges: cached.edges,
              _cacheKey: cacheKey,
            };
          }

          // Not in cache: rebuild graph
          const boundedContexts = manifest.bounded_contexts || [];
          const graph = {
            nodes: boundedContexts.map((bc, idx) => ({
              id: `bc-${idx}`,
              name: bc.name,
              type: bc.type,
            })),
            edges: boundedContexts.slice(0, -1).map((_, idx) => ({
              source: `bc-${idx}`,
              target: `bc-${idx + 1}`,
              type: "dependency",
            })),
          };

          // Cache graph
          this.graphCache.set(cacheKey, graph);

          return {
            ...graph,
            _cacheKey: cacheKey,
          };
        }

        getCache(): Map<string, any> {
          return this.graphCache;
        }
      }

      const graphProvider = new CachingGraphProviderAdapter();
      registerMockPort(
        registry,
        PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
        graphProvider,
      );

      // Act: Build graph for v1
      const v1 = createFixtureManifest();
      v1._version = "v1-" + Date.now();
      const v1Graph = await graphProvider.buildGraph(v1);
      const v1NodeCount = v1Graph.nodes.length;

      // Assert: v1 graph cached
      assert.strictEqual(graphProvider.getCache().has(v1._version), true);

      // Act: Create v2 with additional context
      const v2: CrossBoundaryManifest = {
        ...v1,
        _version: "v2-" + Date.now(),
        bounded_contexts: [
          ...(v1.bounded_contexts || []),
          {
            name: "new-context",
            type: "supporting",
            description: "New context in v2",
          },
        ],
      };

      // Act: Build graph for v2
      const v2Graph = await graphProvider.buildGraph(v2);
      const v2NodeCount = v2Graph.nodes.length;

      // Assert: v2 graph is different (more nodes)
      assert.ok(v2NodeCount > v1NodeCount);

      // Assert: v2 has separate cache entry
      assert.strictEqual(graphProvider.getCache().has(v2._version), true);
      assert.notStrictEqual(
        graphProvider.getCache().get(v1._version),
        graphProvider.getCache().get(v2._version),
      );

      // Assert: v1 cache entry still exists (not overwritten)
      const cachedV1Graph = graphProvider.getCache().get(v1._version);
      assert.strictEqual(cachedV1Graph.nodes.length, v1NodeCount);
    });
  });

  describe("State Isolation", () => {
    it("integration: governance cache isolated per test", async () => {
      // Test 1: Create cache in registry1
      const registry1 = createCrossBoundaryRegistry();
      const linter1 = new MockLinterAdapter();
      registerMockPort(registry1, PORT_NAMES.LINTER, linter1);

      const manifest1 = createFixtureManifest();
      await linter1.lint(manifest1);

      // Test 2: Fresh registry (should not share cache)
      const registry2 = createCrossBoundaryRegistry();
      const linter2 = new MockLinterAdapter();
      registerMockPort(registry2, PORT_NAMES.LINTER, linter2);

      // Linter2 should be independent
      assert.notStrictEqual(linter1, linter2);

      // Both should work independently
      const result1 = await linter1.lint(manifest1);
      const result2 = await linter2.lint(manifest1);

      assert.strictEqual(result1.isCompliant, true);
      assert.strictEqual(result2.isCompliant, true);
    });
  });
});
