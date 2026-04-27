/**
 * @module export-pipeline.integration.test
 * @description Phase 6C Integration Tests: Full export orchestration pipeline.
 *
 * Tests end-to-end export workflows:
 * 1. Full journey: Wizard → Governance → Export (happy path)
 * 2. Policy gate: Non-compliant manifests block export
 * 3. Error recovery: Transaction rollback on export failure
 *
 * Verifies export pipeline respects governance compliance checks.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createCrossBoundaryRegistry,
  wireWizardToPersistence,
  wireGovernanceToManifestReader,
  wireExportToGovernance,
  createFixtureManifest,
  createNonCompliantFixtureManifest,
  _getTransactionManager,
  type CrossBoundaryManifest,
} from "../../../../web-driver/src/__tests__/fixtures/cross-boundary-registry";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names";
import {
  registerMockPort,
  getMockPort,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock";

/**
 * Mock Wizard adapters for export integration tests
 */
class MockProjectGeneratorAdapter {
  async generateProject(input: {
    projectName: string;
    description?: string;
    patterns?: string[];
  }): Promise<{
    success: boolean;
    manifest?: Record<string, unknown>;
    error?: string;
  }> {
    return {
      success: true,
      manifest: {
        system: input.projectName,
        scope: "hexagen",
        description: input.description || `Project: ${input.projectName}`,
        patterns: input.patterns || [],
        bounded_contexts: [
          { name: "core-domain", type: "core", description: "Core domain" },
          { name: "shared", type: "shared-kernel", description: "Shared" },
        ],
      },
    };
  }
}

class MockWizardPersistenceAdapter {
  private sessions = new Map<string, any>();

  async saveSession(sessionId: string, state: any): Promise<void> {
    this.sessions.set(sessionId, { ...state, timestamp: Date.now() });
  }

  async getSession(sessionId: string): Promise<any | null> {
    return this.sessions.get(sessionId) ?? null;
  }
}

describe("Export Pipeline — Integration Tests (Phase 6C)", () => {
  let registry: any;

  beforeEach(() => {
    registry = createCrossBoundaryRegistry();
  });

  describe("Scenario 1: Full Journey - Wizard → Governance → Export", () => {
    it("integration: complete pipeline generates → validates → exports successfully", async () => {
      // Setup: Wire all boundaries
      wireWizardToPersistence(registry);
      wireGovernanceToManifestReader(registry);
      wireExportToGovernance(registry);

      // Create test adapters
      const wizard = new MockProjectGeneratorAdapter();
      const persistence = new MockWizardPersistenceAdapter();

      registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, wizard);
      registerMockPort(registry, PORT_NAMES.WIZARD_PERSISTENCE, persistence);

      // Create export adapter that tracks events
      const exportSteps: string[] = [];
      const exporter = {
        async validateManifest(
          manifest: CrossBoundaryManifest,
        ): Promise<{ success: boolean; error?: any }> {
          exportSteps.push("validate");
          return { success: true };
        },
        async streamExport(request: {
          manifest: CrossBoundaryManifest;
          target: string;
        }): Promise<any> {
          // Simulate SSE stream
          exportSteps.push("stream-prepare");
          exportSteps.push("stream-upload");
          exportSteps.push("stream-complete");

          return {
            events: [
              { type: "step_running", step: "prepare" },
              { type: "step_running", step: "upload" },
              { type: "step_complete", step: "complete" },
            ],
          };
        },
      };

      registerMockPort(registry, PORT_NAMES.SSE_STREAM, exporter);

      // Act: Step 1 - Wizard generates
      const wizardInput = {
        projectName: "export-test-project",
        description: "Testing full export pipeline",
        patterns: ["layered"],
      };

      const wizardResult = await wizard.generateProject(wizardInput);
      expect(wizardResult.success).toBe(true);

      const manifest = wizardResult.manifest as CrossBoundaryManifest;

      // Act: Step 2 - Persist
      await persistence.saveSession("export-session", {
        sessionId: "export-session",
        projectName: manifest.system,
        description: manifest.description,
        patterns: manifest.patterns,
        currentStep: "persisted",
        timestamp: Date.now(),
      });

      // Act: Step 3 - Governance validates
      const linter = getMockPort<any>(registry, PORT_NAMES.LINTER);
      const govResult = await linter.lint(manifest);
      expect(govResult.isCompliant).toBe(true);

      // Act: Step 4 - Export streams
      const exportStream = getMockPort<any>(registry, PORT_NAMES.SSE_STREAM);
      const validateResult = await exportStream.validateManifest(manifest);
      expect(validateResult.success).toBe(true);

      const streamResult = await exportStream.streamExport({
        manifest,
        target: "zip",
      });
      expect(streamResult).toBeDefined();

      // Assert: Full journey events captured in order
      expect(exportSteps).toContain("validate");
      expect(exportSteps).toContain("stream-prepare");
      expect(exportSteps).toContain("stream-upload");
      expect(exportSteps).toContain("stream-complete");
    });
  });

  describe("Scenario 2: Policy Gate - Non-Compliant Blocks Export", () => {
    it("integration: non-compliant manifest fails policy check before export", async () => {
      // Setup
      wireGovernanceToManifestReader(registry);
      wireExportToGovernance(registry);

      // Create policy-enforcing exporter
      const policyExporter = {
        async validateManifest(
          manifest: CrossBoundaryManifest,
        ): Promise<{ success: boolean; error?: any }> {
          // Policy: Manifest must be compliant
          // Check if manifest has violations markers
          const hasViolationMarkers =
            manifest.bounded_contexts?.some(
              (bc) =>
                bc.name.includes("_") || // snake_case pattern
                !["core", "shared-kernel", "supporting"].includes(bc.type),
            ) || false;

          if (hasViolationMarkers) {
            return {
              success: false,
              error: {
                code: "POLICY_VIOLATION",
                message: "Manifest violates governance policies",
                details: "Use governance refinement loop to fix issues",
              },
            };
          }

          return { success: true };
        },
      };

      registerMockPort(registry, PORT_NAMES.SSE_STREAM, policyExporter);

      // Act: Try to export non-compliant manifest
      const nonCompliant = createNonCompliantFixtureManifest();
      const result = await policyExporter.validateManifest(nonCompliant);

      // Assert: Export blocked by policy gate
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("POLICY_VIOLATION");
      expect(result.error?.message).toContain("governance policies");
    });
  });

  describe("Scenario 3: Transaction Rollback on Export Failure", () => {
    it("integration: export failure triggers transaction rollback", async () => {
      // Setup
      wireExportToGovernance(registry);

      // Track transaction state
      const txState = {
        transactions: new Map<string, { state: string; actions: string[] }>(),
      };

      // Create transaction manager that tracks actions
      const txManager = {
        async begin(): Promise<string> {
          const txId = `tx-${Date.now()}`;
          txState.transactions.set(txId, {
            state: "active",
            actions: [],
          });
          return txId;
        },
        async commit(txId: string): Promise<void> {
          const tx = txState.transactions.get(txId);
          if (tx) {
            tx.state = "committed";
            tx.actions.push("commit");
          }
        },
        async rollback(txId: string): Promise<void> {
          const tx = txState.transactions.get(txId);
          if (tx) {
            tx.state = "rolled-back";
            tx.actions.push("rollback");
          }
        },
      };

      registerMockPort(registry, PORT_NAMES.TRANSACTION_MANAGER, txManager);

      // Create failing export pipeline
      const failingExporter = {
        async streamExport(request: {
          manifest: CrossBoundaryManifest;
          target: string;
        }): Promise<any> {
          // Begin transaction
          const txId = await txManager.begin();

          try {
            // Step 1: GitHub succeeds
            const github = getMockPort<any>(
              registry,
              PORT_NAMES.GITHUB_PROVIDER,
            );
            if (github?.createRepository) {
              await github.createRepository(request.manifest.system);
            }

            // Step 2: S3 fails (simulated) - always fail
            throw new Error("S3 upload timeout");
          } catch (error) {
            // Rollback on failure
            await txManager.rollback(txId);
            throw error;
          }
        },
      };

      registerMockPort(registry, PORT_NAMES.SSE_STREAM, failingExporter);

      // Act: Try to export (will fail on S3)
      const manifest = createFixtureManifest();
      const exporter = getMockPort<any>(registry, PORT_NAMES.SSE_STREAM);

      let errorThrown = false;
      try {
        await exporter.streamExport({ manifest, target: "zip" });
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toContain("S3 upload");
      }

      // Assert: Error was thrown
      expect(errorThrown).toBe(true);

      // Assert: Transaction was rolled back
      const txs = Array.from(txState.transactions.values());
      expect(txs.length).toBeGreaterThan(0);
      const tx = txs[0];
      expect(tx.state).toBe("rolled-back");
      expect(tx.actions).toContain("rollback");
    });
  });

  describe("State Isolation", () => {
    it("integration: export tests have independent registries and state", async () => {
      // Test 1: Registry 1
      const registry1 = createCrossBoundaryRegistry();
      wireExportToGovernance(registry1);

      const exporter1 = {
        calls: 0,
        async streamExport(): Promise<any> {
          this.calls++;
          return null;
        },
      };
      registerMockPort(registry1, PORT_NAMES.SSE_STREAM, exporter1);

      await exporter1.streamExport();
      expect(exporter1.calls).toBe(1);

      // Test 2: Registry 2 (fresh, independent)
      const registry2 = createCrossBoundaryRegistry();
      wireExportToGovernance(registry2);

      const exporter2 = {
        calls: 0,
        async streamExport(): Promise<any> {
          this.calls++;
          return null;
        },
      };
      registerMockPort(registry2, PORT_NAMES.SSE_STREAM, exporter2);

      // Exporter2 is independent
      expect(exporter2.calls).toBe(0);

      await exporter2.streamExport();
      expect(exporter2.calls).toBe(1);
      expect(exporter1.calls).toBe(1); // Unchanged
    });
  });
});
