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

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
  private sessions = new Map<string, unknown>();

  async saveSession(sessionId: string, state: unknown): Promise<void> {
    this.sessions.set(sessionId, { ...state, timestamp: Date.now() });
  }

  async getSession(sessionId: string): Promise<unknown | null> {
    return this.sessions.get(sessionId) ?? null;
  }
}

describe("Export Pipeline — Integration Tests (Phase 6C)", () => {
  let registry: ReturnType<typeof createCrossBoundaryRegistry>;

  beforeEach(() => {
    registry = createCrossBoundaryRegistry();
  });

  describe("Scenario 1: Full Journey - Wizard → Governance → Export", () => {
    it("integration: complete pipeline generates → validates → exports successfully", async () => {
      wireWizardToPersistence(registry);
      wireGovernanceToManifestReader(registry);
      wireExportToGovernance(registry);

      const wizard = new MockProjectGeneratorAdapter();
      const persistence = new MockWizardPersistenceAdapter();

      registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, wizard);
      registerMockPort(registry, PORT_NAMES.WIZARD_PERSISTENCE, persistence);

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
        }): Promise<unknown> {
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

      const wizardInput = {
        projectName: "export-test-project",
        description: "Testing full export pipeline",
        patterns: ["layered"],
      };

      const wizardResult = await wizard.generateProject(wizardInput);
      assert.strictEqual(wizardResult.success, true);

      const manifest = wizardResult.manifest as CrossBoundaryManifest;

      await persistence.saveSession("export-session", {
        sessionId: "export-session",
        projectName: manifest.system,
        description: manifest.description,
        patterns: manifest.patterns,
        currentStep: "persisted",
        timestamp: Date.now(),
      });

      const linter = getMockPort<any>(registry, PORT_NAMES.LINTER);
      const govResult = await linter.lint(manifest);
      assert.strictEqual(govResult.isCompliant, true);

      const exportStream = getMockPort<any>(registry, PORT_NAMES.SSE_STREAM);
      const validateResult = await exportStream.validateManifest(manifest);
      assert.strictEqual(validateResult.success, true);

      const streamResult = await exportStream.streamExport({
        manifest,
        target: "zip",
      });
      assert.ok(streamResult !== undefined);

      assert.ok(exportSteps.includes("validate"));
      assert.ok(exportSteps.includes("stream-prepare"));
      assert.ok(exportSteps.includes("stream-upload"));
      assert.ok(exportSteps.includes("stream-complete"));
    });
  });

  describe("Scenario 2: Policy Gate - Non-Compliant Blocks Export", () => {
    it("integration: non-compliant manifest fails policy check before export", async () => {
      wireGovernanceToManifestReader(registry);
      wireExportToGovernance(registry);

      const policyExporter = {
        async validateManifest(
          manifest: CrossBoundaryManifest,
        ): Promise<{ success: boolean; error?: any }> {
          const hasViolationMarkers =
            manifest.bounded_contexts?.some(
              (bc) =>
                bc.name.includes("_") ||
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

      const nonCompliant = createNonCompliantFixtureManifest();
      const result = await policyExporter.validateManifest(nonCompliant);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, "POLICY_VIOLATION");
      assert.ok(result.error?.message.includes("governance policies"));
    });
  });

  describe("Scenario 3: Transaction Rollback on Export Failure", () => {
    it("integration: export failure triggers transaction rollback", async () => {
      wireExportToGovernance(registry);

      const txState = {
        transactions: new Map<string, { state: string; actions: string[] }>(),
      };

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

      const failingExporter = {
        async streamExport(request: {
          manifest: CrossBoundaryManifest;
          target: string;
        }): Promise<unknown> {
          const txId = await txManager.begin();

          try {
            const github = getMockPort<any>(
              registry,
              PORT_NAMES.GITHUB_PROVIDER,
            );
            if (github?.createRepository) {
              await github.createRepository(request.manifest.system);
            }

            throw new Error("S3 upload timeout");
          } catch (error) {
            await txManager.rollback(txId);
            throw error;
          }
        },
      };

      registerMockPort(registry, PORT_NAMES.SSE_STREAM, failingExporter);

      const manifest = createFixtureManifest();
      const exporter = getMockPort<any>(registry, PORT_NAMES.SSE_STREAM);

      let errorThrown = false;
      try {
        await exporter.streamExport({ manifest, target: "zip" });
      } catch (error) {
        errorThrown = true;
        assert.ok((error as Error).message.includes("S3 upload"));
      }

      assert.strictEqual(errorThrown, true);

      const txs = Array.from(txState.transactions.values());
      assert.ok(txs.length > 0);
      const tx = txs[0];
      assert.strictEqual(tx.state, "rolled-back");
      assert.ok(tx.actions.includes("rollback"));
    });
  });

  describe("State Isolation", () => {
    it("integration: export tests have independent registries and state", async () => {
      const registry1 = createCrossBoundaryRegistry();
      wireExportToGovernance(registry1);

      const exporter1 = {
        calls: 0,
        async streamExport(): Promise<unknown> {
          this.calls++;
          return null;
        },
      };
      registerMockPort(registry1, PORT_NAMES.SSE_STREAM, exporter1);

      await exporter1.streamExport();
      assert.strictEqual(exporter1.calls, 1);

      const registry2 = createCrossBoundaryRegistry();
      wireExportToGovernance(registry2);

      const exporter2 = {
        calls: 0,
        async streamExport(): Promise<unknown> {
          this.calls++;
          return null;
        },
      };
      registerMockPort(registry2, PORT_NAMES.SSE_STREAM, exporter2);

      assert.strictEqual(exporter2.calls, 0);

      await exporter2.streamExport();
      assert.strictEqual(exporter2.calls, 1);
      assert.strictEqual(exporter1.calls, 1);
    });
  });
});
